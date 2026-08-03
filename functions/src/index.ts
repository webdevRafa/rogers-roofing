// functions/src/index.ts
import { onObjectFinalized } from "firebase-functions/v2/storage";
import { onDocumentCreated, onDocumentDeleted } from "firebase-functions/v2/firestore";
import { setGlobalOptions } from "firebase-functions/v2/options";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { Resend } from 'resend';

import * as admin from "firebase-admin";
import * as path from "path";
import * as os from "os";
import * as fs from "fs/promises";
import sharp from "sharp";
import { randomUUID } from "node:crypto";

import { defineSecret } from "firebase-functions/params";

const RESEND_API_KEY = defineSecret("RESEND_API_KEY");
const INVITE_FROM_EMAIL = defineSecret("INVITE_FROM_EMAIL");
const APP_BASE_URL = defineSecret("APP_BASE_URL");

admin.initializeApp();
setGlobalOptions({ region: "us-central1", memory: "1GiB", timeoutSeconds: 540 });

const allowedLeadServices = new Set([
  "roof_replacement",
  "roof_repair",
  "storm_damage",
  "new_construction",
  "inspection",
  "commercial_roofing",
  "gutters",
  "other",
]);

function cleanLeadText(value: unknown, maxLength: number): string {
  return String(value ?? "").trim().slice(0, maxLength);
}

async function resolvePublicOrganizationId(): Promise<string> {
  const organizations = admin.firestore().collection("organizations");
  const preferredId =
    cleanLeadText(process.env.PUBLIC_ORGANIZATION_ID, 100) ||
    "rogers-roofing";
  const preferred = await organizations.doc(preferredId).get();

  if (preferred.exists) return preferred.id;

  const matchingSlug = await organizations
    .where("slug", "==", "rogers-roofing")
    .limit(1)
    .get();
  if (!matchingSlug.empty) return matchingSlug.docs[0].id;

  // This is a single-business Firebase project. Falling back to its existing
  // organization keeps public requests aligned with legacy membership ids.
  const existingOrganization = await organizations.limit(1).get();
  return existingOrganization.empty
    ? preferredId
    : existingOrganization.docs[0].id;
}

/**
 * Public lead intake used by the client-facing website.
 *
 * The callable keeps anonymous visitors away from direct Firestore writes,
 * validates the customer-facing payload, and creates a server-timestamped
 * record for the admin lead pipeline.
 */
export const submitWebsiteLead = onCall(
  { region: "us-central1" },
  async (request) => {
    const data = request.data ?? {};

    // Honeypot field: real visitors never see or fill this input.
    if (cleanLeadText(data.website, 200)) {
      return { ok: true };
    }

    const firstName = cleanLeadText(data.firstName, 80);
    const lastName = cleanLeadText(data.lastName, 80);
    const email = cleanLeadText(data.email, 180).toLowerCase();
    const phone = cleanLeadText(data.phone, 40);
    const address = cleanLeadText(data.address, 240);
    const message = cleanLeadText(data.message, 3000);
    const service = cleanLeadText(data.service, 60);
    const urgency = cleanLeadText(data.urgency, 40);
    const preferredContact = cleanLeadText(data.preferredContact, 20);
    const organizationId = await resolvePublicOrganizationId();

    if (!firstName || !lastName || !email || !phone || !address) {
      throw new HttpsError(
        "invalid-argument",
        "Name, email, phone, and property address are required."
      );
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new HttpsError("invalid-argument", "Enter a valid email address.");
    }
    if (!allowedLeadServices.has(service)) {
      throw new HttpsError("invalid-argument", "Select a valid service.");
    }
    if (data.consent !== true) {
      throw new HttpsError(
        "failed-precondition",
        "Contact consent is required."
      );
    }

    const leadRef = admin.firestore().collection("leads").doc();
    const receivedAt = new Date();
    const requestNumber = [
      "RR",
      receivedAt.getUTCFullYear(),
      String(receivedAt.getUTCMonth() + 1).padStart(2, "0"),
      leadRef.id.slice(0, 6).toUpperCase(),
    ].join("-");

    await leadRef.set({
      organizationId,
      orgId: organizationId,
      requestNumber,
      requestType: "estimate_request",
      status: "new",
      firstName,
      lastName,
      email,
      phone,
      preferredContact: ["phone", "text", "email"].includes(preferredContact)
        ? preferredContact
        : "phone",
      propertyAddress: {
        fullLine: address,
        country: "US",
      },
      service,
      propertyType: cleanLeadText(data.propertyType, 40) || "residential",
      urgency: ["emergency", "within_week", "within_month", "planning"].includes(
        urgency
      )
        ? urgency
        : "within_month",
      message,
      insuranceClaimStarted: Boolean(data.insuranceClaimStarted),
      consentToContact: true,
      source: "website",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return {
      ok: true,
      leadId: leadRef.id,
      requestNumber,
      status: "new",
    };
  }
);

/**
 * 1) Convert uploads at jobs/{jobId}/attachments/* to WEBP (q=90),
 *    write a doc in jobPhotos, bump counters on the job, delete original.
 */
export const processJobPhoto = onObjectFinalized({ bucket: "rogers-roofing.firebasestorage.app", region: "us-central1" }, async (event) => {
  const filePath = event.data.name || "";
  const bucketName = event.data.bucket;
  const contentType = event.data.contentType || "";
  const metadata = event.data.metadata || {};

  if (!filePath.startsWith("jobs/")) return;
  if (!filePath.includes("/attachments/")) return;
  if (filePath.endsWith("_webp90.webp")) return; // avoid loops
  if (!contentType.startsWith("image/")) return;

  const bucket = admin.storage().bucket(bucketName);

  // Paths
  const dirname = path.dirname(filePath);
  const basename = path.basename(filePath, path.extname(filePath));
  const webpFileName = `${basename}_webp90.webp`;
  const webpDestPath = path.join(dirname, webpFileName);

  // Temp files
  const tempOriginal = path.join(os.tmpdir(), path.basename(filePath));
  const tempWebp = path.join(os.tmpdir(), webpFileName);

  try {
    // Download original
    await bucket.file(filePath).download({ destination: tempOriginal });

    // Convert → WEBP q=90
    await sharp(tempOriginal).rotate().webp({ quality: 90 }).toFile(tempWebp);

    // Upload derivative with a token
    const token = randomUUID();
    await bucket.upload(tempWebp, {
      destination: webpDestPath,
      metadata: {
        contentType: "image/webp",
        metadata: { firebaseStorageDownloadTokens: token },
      },
    });

    // Build public URL
    const url = `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(
      webpDestPath
    )}?alt=media&token=${token}`;

    // Parse jobId from path
    const match = filePath.match(/^jobs\/([^/]+)\/attachments\//);
    const jobId = match?.[1];
    const caption = (metadata.caption as string) || "";

    if (jobId) {
      const db = admin.firestore();
      const batch = db.batch();

      // Create photo document
      const photoRef = db.collection("jobPhotos").doc();
      batch.set(photoRef, {
        jobId,
        url,
        path: webpDestPath,
        caption,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Update job counters
      const jobRef = db.doc(`jobs/${jobId}`);
      batch.set(
        jobRef,
        {
          photoCount: admin.firestore.FieldValue.increment(1),
          lastPhotoUrl: url,
          lastPhotoAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      await batch.commit();
    }

    // Delete the original to save storage
    await bucket.file(filePath).delete().catch(() => {});
  } catch (err) {
    console.error("processJobPhoto error:", err);
  } finally {
    await fs.unlink(tempOriginal).catch(() => {});
    await fs.unlink(tempWebp).catch(() => {});
  }
});

/**
 * 2) When a jobPhotos doc is deleted, remove the Storage file and decrement counters.
 *    onDocumentDeleted provides a single snapshot; use event.data.data().
 */
export const cleanupPhotoOnDelete = onDocumentDeleted("jobPhotos/{photoId}", async (event) => {
  const snap = event.data; // QueryDocumentSnapshot of the deleted doc
  if (!snap) return;

  const data = snap.data() as { path?: string; jobId?: string; url?: string } | undefined;
  if (!data) return;

  try {
    // Delete the webp file in Storage (if we stored the path)
    if (data.path) {
      const bucket = admin.storage().bucket();
      await bucket.file(data.path).delete().catch(() => {});
    }

    // Decrement photoCount on the job
    if (data.jobId) {
      await admin.firestore().doc(`jobs/${data.jobId}`).set(
        {
          photoCount: admin.firestore.FieldValue.increment(-1),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }
  } catch (err) {
    console.error("cleanupPhotoOnDelete error:", err);
  }
});


/**
 * claimEmployeeInvite
 *
 * Callable Cloud Function to allow an authenticated user to claim an employee
 * invite.  It expects an `inviteId` in the request data and uses context.auth
 * to determine the caller's uid.  It marks the invite as accepted, attaches
 * the user's uid to the employee document, and copies any role/accessRole
 * snapshots if those fields are unset on the employee.  Errors are thrown
 * for unauthenticated callers, missing invites, or non-pending invites.
 */

function getResend() {
  const key = RESEND_API_KEY.value();
  if (!key) throw new Error("Missing RESEND_API_KEY secret");
  return new Resend(key);
}


export const claimEmployeeInvite = onCall(
  { region: "us-central1" },
  async (request) => {
    const inviteId = request.data?.inviteId as string | undefined;
    const auth = request.auth;
    if (!auth || !auth.uid) {
      throw new HttpsError(
        "unauthenticated",
        "The function must be called while authenticated."
      );
    }
    if (!inviteId) {
      throw new HttpsError("invalid-argument", "Missing inviteId parameter.");
    }
    const uid = auth.uid;
    const db = admin.firestore();
    const inviteRef = db.doc(`employeeInvites/${inviteId}`);
    const inviteSnap = await inviteRef.get();
    if (!inviteSnap.exists) {
      throw new HttpsError("not-found", "Invite not found.");
    }
    const invite = inviteSnap.data() as any;
    if (invite.status !== "pending") {
      throw new HttpsError(
        "failed-precondition",
        `Invite is not pending (current status: ${invite.status}).`
      );
    }

    // NEW: Verify that the current user’s email matches the invite email.
    // auth.token.email is populated for email/password and most OAuth sign-ins.
    const callerEmail = String(auth.token?.email || "").trim().toLowerCase();
    const inviteEmail = String(invite.email || "").trim().toLowerCase();
    if (!callerEmail || callerEmail !== inviteEmail) {
      throw new HttpsError(
        "failed-precondition",
        `This invite is for ${inviteEmail}, but you are signed in as ${callerEmail}.`
      );
    }

    const employeeRef = db.doc(`employees/${invite.employeeId}`);
    await db.runTransaction(async (trx) => {
      const employeeSnap = await trx.get(employeeRef);
      if (!employeeSnap.exists) {
        throw new HttpsError(
          "not-found",
          "Employee associated with invite not found."
        );
      }
      const employee = employeeSnap.data() as any;
      // Prepare updates
      const empUpdates: any = {
        userId: uid,
        invite: Object.assign({}, employee.invite || {}, {
          status: "accepted",
          acceptedAt: admin.firestore.FieldValue.serverTimestamp(),
        }),
      };
      // Copy snapshots if employee doesn't already have role/accessRole
      if (!employee.role && invite.roleSnapshot) {
        empUpdates.role = invite.roleSnapshot;
      }
      if (!employee.accessRole && invite.accessRoleSnapshot) {
        empUpdates.accessRole = invite.accessRoleSnapshot;
      }
      trx.update(employeeRef, empUpdates);
      trx.update(inviteRef, {
        status: "accepted",
        acceptedAt: admin.firestore.FieldValue.serverTimestamp(),
        acceptedByUserId: uid,
      });
    });
    return { ok: true };
  }
);



// Create full accept‑invite URL using APP_BASE_URL
function buildInviteLink(inviteId: string): string {
  const baseUrl = (APP_BASE_URL.value() || "").replace(/\/$/, "");
  return `${baseUrl}/accept-invite?inviteId=${encodeURIComponent(inviteId)}`;
}

async function sendInviteEmail(toEmail: string, inviteId: string) {
  const resend = getResend(); // ✅ add this
  const inviteUrl = buildInviteLink(inviteId);

  const from = (INVITE_FROM_EMAIL.value() || "Roger's Roofing <no-reply@rogersroofingtx.com>").trim();
  const subject = "You have been invited to join Roger's Roofing";

  const html = `
    <p>Hello,</p>
    <p>You’ve been invited to join the Rogers Roofing team. Click the link below to accept your invitation:</p>
    <p><a href="${inviteUrl}">${inviteUrl}</a></p>
    <p>If you weren’t expecting this invitation, you can ignore this email.</p>
  `;

  const { error } = await resend.emails.send({
    from,
    to: [toEmail],
    subject,
    html,
  });

  if (error) throw new Error(`Resend error: ${error.message || String(error)}`);
}


export const sendEmployeeInvite = onCall(
  { region: "us-central1", secrets: [RESEND_API_KEY, INVITE_FROM_EMAIL, APP_BASE_URL], },
  async (request) => {
    const inviteId = request.data?.inviteId as string | undefined;
    const auth = request.auth;
    if (!auth || !auth.uid) {
      throw new HttpsError(
        "unauthenticated",
        "The function must be called while authenticated."
      );
    }
    if (!inviteId) {
      throw new HttpsError("invalid-argument", "Missing inviteId parameter.");
    }
    const db = admin.firestore();
    const inviteRef = db.doc(`employeeInvites/${inviteId}`);
    const inviteSnap = await inviteRef.get();
    if (!inviteSnap.exists) {
      throw new HttpsError("not-found", "Invite not found.");
    }
    const invite = inviteSnap.data() as any;
    const employeeRef = db.doc(`employees/${invite.employeeId}`);
    const employeeSnap = await employeeRef.get();
    if (!employeeSnap.exists) {
      throw new HttpsError(
        "not-found",
        "Employee associated with invite not found."
      );
    }
    // Only send invites in pending or none states.  Adjust logic as needed.
    const currentStatus = invite.status || "pending";
    if (currentStatus !== "pending" && currentStatus !== "sent") {
      throw new HttpsError(
        "failed-precondition",
        `Invite status is ${currentStatus}; cannot send.`
      );
    }
    const toEmail = String(invite.email || "").trim();
    if (!toEmail) {
      throw new HttpsError(
        "invalid-argument",
        "Invite is missing an email address."
      );
    }
    // Attempt to send the email via Resend
    try {
      await sendInviteEmail(toEmail, inviteId);
    } catch (err: any) {
      console.error(err);
      throw new HttpsError(
        "internal",
        err?.message || "Failed to send invite email."
      );
    }
    // Update lastSentAt fields on invite and employee docs
    const now = admin.firestore.FieldValue.serverTimestamp();
    const batch = db.batch();
    batch.set(inviteRef, { lastSentAt: now }, { merge: true });

    // update employee.invite.lastSentAt and ensure status is pending and inviteDocId
    const employeeInviteMeta = (employeeSnap.data() as any).invite || {};
    batch.set(
      employeeRef,
      {
        invite: {
          ...employeeInviteMeta,
          status: "pending",
          lastSentAt: now,
          inviteDocId: inviteId,
        },
      },
      { merge: true }
    );
    await batch.commit();
    return { ok: true };
  }
);

export const onEmployeeInviteCreated = onDocumentCreated(
  {
    document: "employeeInvites/{inviteId}",
    region: "us-central1",
    secrets: [RESEND_API_KEY, INVITE_FROM_EMAIL, APP_BASE_URL],
  },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const data = snap.data() as any;
    if (!data) return;
    const inviteId = snap.id;
    // Only send if status is pending and lastSentAt is not set
    if (data.status !== "pending" || data.lastSentAt) return;
    const toEmail = String(data.email || "").trim();
    if (!toEmail) return;
    try {
      await sendInviteEmail(toEmail, inviteId);
      // update Firestore documents after sending
      const db = admin.firestore();
      const now = admin.firestore.FieldValue.serverTimestamp();
      const inviteRef = db.doc(`employeeInvites/${inviteId}`);
      const employeeRef = db.doc(`employees/${data.employeeId}`);
      const batch = db.batch();
      batch.set(
        inviteRef,
        {
          lastSentAt: now,
        },
        { merge: true }
      );
      // Load the employee doc to merge existing invite metadata
      const empSnap = await employeeRef.get();
      const empData = empSnap.exists ? (empSnap.data() as any) : {};
      const existingInviteMeta = empData.invite || {};
      batch.set(
        employeeRef,
        {
          invite: {
            ...existingInviteMeta,
            status: "pending",
            email: data.email,
            lastSentAt: now,
            inviteDocId: inviteId,
          },
        },
        { merge: true }
      );
      await batch.commit();
    } catch (err) {
      console.error("Failed to send invite email on create:", err);
    }
  }
);

async function ensureInvoicePublicToken(invoiceId: string, invoice: any): Promise<string> {
  const existing = String(invoice.publicToken || "").trim();
  if (existing) return existing;

  const token = randomUUID();
  await admin.firestore().doc(`invoices/${invoiceId}`).set(
    { publicToken: token },
    { merge: true }
  );

  return token;
}


export const sendInvoiceEmail = onCall(
  {
    region: "us-central1",
    secrets: [RESEND_API_KEY, INVITE_FROM_EMAIL, APP_BASE_URL],
  },
  async (request) => {
    // Auth guard
    if (!request.auth?.uid) {
      throw new HttpsError("unauthenticated", "You must be signed in.");
    }

    const invoiceId = String(request.data?.invoiceId || "").trim();
    const email = String(request.data?.email || "").trim();
    if (!invoiceId) {
      throw new HttpsError("invalid-argument", "Missing invoiceId.");
    }
    if (!email || !email.includes("@")) {
      throw new HttpsError("invalid-argument", "Missing/invalid email.");
    }

    const db = admin.firestore();
    // Pull invoice doc
    const snap = await db.doc(`invoices/${invoiceId}`).get();
    if (!snap.exists) {
      throw new HttpsError("not-found", "Invoice not found.");
    }
    const invoice = snap.data() as any;

    // Multi-tenant check: require orgId on invoice and match caller’s org
    const invoiceOrgId = String(invoice.orgId || "").trim();
    if (!invoiceOrgId) {
      throw new HttpsError(
        "failed-precondition",
        "Invoice missing orgId. Re-save invoice with latest schema."
      );
    }
    const uid = request.auth.uid;
    const userSnap = await db.doc(`users/${uid}`).get();
    const userOrgId = userSnap.exists ? String((userSnap.data() as any).orgId || "") : "";
    let employeeOrgId = "";
    if (!userOrgId) {
      const empQ = await db
        .collection("employees")
        .where("userId", "==", uid)
        .limit(1)
        .get();
      if (!empQ.empty) {
        employeeOrgId = String((empQ.docs[0].data() as any).orgId || "");
      }
    }
    const callerOrgId = userOrgId || employeeOrgId;
    if (!callerOrgId || callerOrgId !== invoiceOrgId) {
      throw new HttpsError("permission-denied", "Not allowed to send this invoice.");
    }

    // Idempotency: skip if already sent recently
    const last = invoice.lastEmailSentAt?.toDate?.() ?? null;
    if (last) {
      const ms = Date.now() - last.getTime();
      if (ms >= 0 && ms < 2 * 60 * 1000) {
        return { ok: true, id: null, skipped: true, reason: "recently_sent" };
      }
    }
    // Skip if another send is already in-flight
    const inFlight = invoice.emailSendInFlightAt?.toDate?.() ?? null;
    if (inFlight) {
      const ms = Date.now() - inFlight.getTime();
      if (ms >= 0 && ms < 2 * 60 * 1000) {
      return { ok: true, id: null, skipped: true, reason: "in_flight" };
      }
    }

    // Set in-flight lock (non-fatal if it fails)
    try {
      await db.doc(`invoices/${invoiceId}`).set(
        { emailSendInFlightAt: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true }
      );
    } catch (err) {
      console.error("Failed to set emailSendInFlightAt (non-fatal):", err);
    }

    try {
      // Prepare Resend
      const resend = getResend();
      const from = INVITE_FROM_EMAIL.value();
      const appBase = APP_BASE_URL.value();
      if (!from) throw new HttpsError("failed-precondition", "Missing INVITE_FROM_EMAIL secret.");
      if (!appBase)
        throw new HttpsError("failed-precondition", "Missing APP_BASE_URL secret.");

      // Build subject, HTML and invoice link
      const number = invoice.number || "Invoice";
      const totalCents = Number(invoice.money?.totalCents || 0);
      const total = (totalCents / 100).toLocaleString(undefined, {
        style: "currency",
        currency: "USD",
      });
      const publicToken = await ensureInvoicePublicToken(invoiceId, invoice);
      const invoiceUrl = buildInvoiceLink(invoiceId, publicToken);
      const subject = `${number} from Roger’s Roofing`;
      const html = `
        <div style="font-family: ui-sans-serif, system-ui, -apple-system; line-height:1.5;">
          <h2 style="margin:0 0 8px;">${number}</h2>
          <p style="margin:0 0 12px;">Total due: <b>${total}</b></p>
          <p style="margin:0 0 16px;">
            View your invoice here:
            <a href="${invoiceUrl}">${invoiceUrl}</a>
          </p>
          <p style="margin:0; color:#666; font-size:12px;">
            If you have any questions, reply to this email.
          </p>
        </div>
      `;

      // Send email via Resend
      const { data, error } = await resend.emails.send({
        from,
        to: [email],
        subject,
        html,
      });
      if (error) {
        console.error("Resend invoice send error:", error);
        throw new HttpsError("internal", error.message || "Failed to send invoice email.");
      }

      // Record timestamp and Resend ID for auditing (non-fatal)
      try {
        await db.doc(`invoices/${invoiceId}`).set(
          {
            lastEmailSentAt: admin.firestore.FieldValue.serverTimestamp(),
            lastEmailResendId: data?.id || null,
          },
          { merge: true }
        );
      } catch (err) {
        console.error("Failed to update invoice email audit fields:", err);
      }

      return { ok: true, id: data?.id || null };
    } finally {
      // Always clear in-flight lock (non-fatal)
      try {
        await db.doc(`invoices/${invoiceId}`).set(
          { emailSendInFlightAt: admin.firestore.FieldValue.delete() },
          { merge: true }
        );
      } catch (err) {
        console.error("Failed to clear emailSendInFlightAt:", err);
      }
    }
  }
);



// Helper to build invoice URL from APP_BASE_URL.  Duplicated logic from
// sendInvoiceEmail so triggers can reuse it.
function buildInvoiceLink(invoiceId: string, publicToken: string): string {
  const baseUrl = (APP_BASE_URL.value() || "").replace(/\/$/, "");
  return `${baseUrl}/invoice/${encodeURIComponent(invoiceId)}?token=${encodeURIComponent(publicToken)}`;
}



// Helper to send the invoice via Resend using the same template as sendInvoiceEmail.
// This function runs server-side and does not perform auth/org checks; callers must
// enforce appropriate permissions.  It updates lastEmailSentAt on the invoice doc.
async function sendInvoiceViaResend(invoiceId: string, invoice: any, toEmail: string) {
  const resend = getResend();
  const from = INVITE_FROM_EMAIL.value();
  const appBase = APP_BASE_URL.value();
  if (!from) throw new Error("Missing INVITE_FROM_EMAIL secret.");
  if (!appBase) throw new Error("Missing APP_BASE_URL secret.");
  const number = invoice.number || "Invoice";
  const totalCents = Number(invoice.money?.totalCents || 0);
  const total = (totalCents / 100).toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
  });
  const publicToken = await ensureInvoicePublicToken(invoiceId, invoice);
const invoiceUrl = buildInvoiceLink(invoiceId, publicToken);

  const subject = `${number} from Roger’s Roofing`;
  const html = `
      <div style="font-family: ui-sans-serif, system-ui, -apple-system; line-height:1.5;">
        <h2 style="margin:0 0 8px;">${number}</h2>
        <p style="margin:0 0 12px;">Total due: <b>${total}</b></p>
        <p style="margin:0 0 16px;">
          View your invoice here:
          <a href="${invoiceUrl}">${invoiceUrl}</a>
        </p>
        <p style="margin:0; color:#666; font-size:12px;">
          If you have any questions, reply to this email.
        </p>
      </div>
    `;
  const { error } = await resend.emails.send({
    from,
    to: [toEmail],
    subject,
    html,
  });
  if (error) {
    throw new Error(error.message || "Failed to send invoice email.");
  }
  // update lastEmailSentAt on the invoice
  const now = admin.firestore.FieldValue.serverTimestamp();
  await admin.firestore().doc(`invoices/${invoiceId}`).set(
    { lastEmailSentAt: now },
    { merge: true }
  );
}

/**
 * onInvoiceCreated
 *
 * Firestore trigger that automatically sends an invoice email when an invoice
 * document is first created with status "sent" and a customer email.  This
 * mirrors the auto-send behavior used for employee invites and makes the
 * feature more reliable by not relying solely on the client to call the
 * sendInvoiceEmail callable.  It also prevents duplicate sends by checking
 * for an existing lastEmailSentAt timestamp.
 */
export const onInvoiceCreated = onDocumentCreated(
  {
    document: "invoices/{invoiceId}",
    region: "us-central1",
    secrets: [RESEND_API_KEY, INVITE_FROM_EMAIL, APP_BASE_URL],
  },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const data = snap.data() as any;
    if (!data) return;
    const invoiceId = snap.id;
    // Only send if the invoice is marked as sent, has a customer email, and
    // hasn't been emailed before.
    if (data.status !== "sent") return;
    const email = data.customer?.email;
    if (!email) return;
    if (data.lastEmailSentAt) return;
    try {
      await sendInvoiceViaResend(invoiceId, data, email);
    } catch (err) {
      console.error("Failed to send invoice email on create:", err);
    }
  }
);

function escapeEmailHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function timestampDate(value: unknown): Date | undefined {
  const record = asRecord(value);
  return typeof record.toDate === "function"
    ? (record.toDate as () => Date)()
    : undefined;
}

async function assertOrganizationAccess(uid: string, organizationId: string) {
  const db = admin.firestore();
  const membership = await db
    .collection("memberships")
    .where("userId", "==", uid)
    .where("orgId", "==", organizationId)
    .where("status", "==", "active")
    .limit(1)
    .get();

  if (!membership.empty) return;

  // Backward compatibility for the legacy single-organization records.
  const user = await db.doc(`users/${uid}`).get();
  if (user.exists && String(user.data()?.orgId || "") === organizationId) {
    return;
  }
  const employee = await db
    .collection("employees")
    .where("userId", "==", uid)
    .where("orgId", "==", organizationId)
    .limit(1)
    .get();
  if (!employee.empty) return;

  throw new HttpsError(
    "permission-denied",
    "You do not have access to this estimate."
  );
}

async function ensureEstimatePublicToken(
  estimateId: string,
  estimate: Record<string, unknown>
): Promise<string> {
  const existing = String(estimate.publicToken || "").trim();
  if (existing) return existing;
  const token = randomUUID();
  await admin.firestore().doc(`estimates/${estimateId}`).set(
    { publicToken: token },
    { merge: true }
  );
  return token;
}

function buildEstimateLink(estimateId: string, publicToken: string): string {
  const baseUrl = (APP_BASE_URL.value() || "").replace(/\/$/, "");
  return `${baseUrl}/estimate/${encodeURIComponent(estimateId)}?token=${encodeURIComponent(publicToken)}`;
}

export const sendEstimateEmail = onCall(
  {
    region: "us-central1",
    secrets: [RESEND_API_KEY, INVITE_FROM_EMAIL, APP_BASE_URL],
  },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError("unauthenticated", "You must be signed in.");
    }

    const estimateId = String(request.data?.estimateId || "").trim();
    const email = String(request.data?.email || "").trim().toLowerCase();
    if (!estimateId) {
      throw new HttpsError("invalid-argument", "Missing estimateId.");
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new HttpsError("invalid-argument", "Enter a valid customer email.");
    }

    const db = admin.firestore();
    const estimateRef = db.doc(`estimates/${estimateId}`);
    const snapshot = await estimateRef.get();
    if (!snapshot.exists) {
      throw new HttpsError("not-found", "Estimate not found.");
    }
    const estimate = snapshot.data() as Record<string, unknown>;
    const customer = asRecord(estimate.customerSnapshot);
    const organization = asRecord(estimate.organizationSnapshot);
    const organizationId = String(
      estimate.organizationId || estimate.orgId || ""
    ).trim();
    if (!organizationId) {
      throw new HttpsError(
        "failed-precondition",
        "Estimate is missing its organization."
      );
    }
    await assertOrganizationAccess(request.auth.uid, organizationId);

    const lastSent = timestampDate(estimate.lastEmailSentAt);
    if (lastSent && Date.now() - lastSent.getTime() < 2 * 60 * 1000) {
      const publicToken = await ensureEstimatePublicToken(estimateId, estimate);
      return {
        ok: true,
        skipped: true,
        reason: "recently_sent",
        publicUrl: buildEstimateLink(estimateId, publicToken),
      };
    }

    const inFlight = timestampDate(estimate.emailSendInFlightAt);
    if (inFlight && Date.now() - inFlight.getTime() < 2 * 60 * 1000) {
      return { ok: true, skipped: true, reason: "in_flight" };
    }

    await estimateRef.set(
      { emailSendInFlightAt: admin.firestore.FieldValue.serverTimestamp() },
      { merge: true }
    );

    try {
      const publicToken = await ensureEstimatePublicToken(estimateId, estimate);
      const estimateUrl = buildEstimateLink(estimateId, publicToken);
      const rawNumber = String(estimate.number || "Estimate");
      const number = escapeEmailHtml(rawNumber);
      const customerName = escapeEmailHtml(
        customer.name || "there"
      );
      const rawBusinessName = String(
        organization.legalName ||
          organization.name ||
          "Roger's Roofing"
      );
      const businessName = escapeEmailHtml(rawBusinessName);
      const total = (Number(estimate.totalCents || 0) / 100).toLocaleString(
        "en-US",
        { style: "currency", currency: "USD" }
      );
      const resend = getResend();
      const from = (
        INVITE_FROM_EMAIL.value() ||
        "Roger's Roofing <no-reply@rogersroofingtx.com>"
      ).trim();
      const subject = `${rawNumber} from ${rawBusinessName}`;
      const html = `
        <div style="background:#f4f1ec;padding:32px 16px;font-family:Arial,Helvetica,sans-serif;color:#24231f;">
          <div style="max-width:620px;margin:0 auto;background:#ffffff;border:1px solid #ddd6cc;border-top:6px solid #b71920;border-radius:10px;padding:34px;">
            <p style="margin:0 0 8px;color:#b71920;font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;">Professional roofing estimate</p>
            <h1 style="margin:0 0 20px;font-family:Georgia,serif;font-size:32px;font-weight:400;">${number}</h1>
            <p style="margin:0 0 12px;line-height:1.6;">Hello ${customerName},</p>
            <p style="margin:0 0 22px;line-height:1.6;color:#5f5a54;">${businessName} prepared an itemized estimate for your roofing project. The current estimate total is <strong style="color:#24231f;">${escapeEmailHtml(total)}</strong>.</p>
            <p style="margin:0 0 24px;"><a href="${estimateUrl}" style="display:inline-block;background:#b71920;color:#ffffff;text-decoration:none;border-radius:7px;padding:13px 18px;font-weight:700;">View estimate</a></p>
            <p style="margin:0;color:#817a72;font-size:12px;line-height:1.5;">The private link includes the complete scope, quantities, rates, warranty information, and a print / download option. Reply to this email if you have any questions.</p>
          </div>
        </div>
      `;

      const { data, error } = await resend.emails.send({
        from,
        to: [email],
        subject,
        html,
      });
      if (error) {
        throw new HttpsError(
          "internal",
          error.message || "Failed to send estimate email."
        );
      }

      await estimateRef.set(
        {
          status: "sent",
          sentAt:
            estimate.sentAt || admin.firestore.FieldValue.serverTimestamp(),
          lastEmailSentAt: admin.firestore.FieldValue.serverTimestamp(),
          lastEmailResendId: data?.id || null,
          publicToken,
          emailSendInFlightAt: admin.firestore.FieldValue.delete(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      return { ok: true, id: data?.id || null, publicUrl: estimateUrl };
    } catch (error) {
      await estimateRef.set(
        { emailSendInFlightAt: admin.firestore.FieldValue.delete() },
        { merge: true }
      );
      if (error instanceof HttpsError) throw error;
      console.error("Failed to send estimate email:", error);
      throw new HttpsError("internal", "Failed to send estimate email.");
    }
  }
);

export const getPublicEstimate = onCall(
  { region: "us-central1" },
  async (request) => {
    const estimateId = String(request.data?.estimateId || "").trim();
    const token = String(request.data?.token || "").trim();
    if (!estimateId || !token) {
      throw new HttpsError("invalid-argument", "Invalid estimate link.");
    }

    const estimateRef = admin.firestore().doc(`estimates/${estimateId}`);
    const snapshot = await estimateRef.get();
    if (!snapshot.exists) {
      throw new HttpsError("not-found", "Estimate not found.");
    }
    const estimate = snapshot.data() as Record<string, unknown>;
    if (!estimate.publicToken || estimate.publicToken !== token) {
      throw new HttpsError("permission-denied", "Invalid estimate link.");
    }

    if (estimate.status === "sent") {
      await estimateRef.set(
        {
          status: "viewed",
          viewedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }

    const publicLineItems = Array.isArray(estimate.lineItems)
      ? estimate.lineItems
          .filter(
            (line: unknown) => {
              const record = asRecord(line);
              return (
                record.customerVisible !== false && record.selected !== false
              );
            }
          )
          .map((line: unknown) => {
            const record = asRecord(line);
            return {
              id: String(record.id || ""),
              category: String(record.category || "roofing_scope"),
              title: String(record.title || ""),
              customerDescription: String(record.customerDescription || ""),
              quantity: Number(record.quantity || 0),
              unit: String(record.unit || "LS"),
              unitPriceCents: Number(record.unitPriceCents || 0),
              lineTotalCents: Number(record.lineTotalCents || 0),
              discountCents: Number(record.discountCents || 0),
              pricingMode: String(record.pricingMode || "unit_price"),
              selectionType: String(record.selectionType || "base"),
              selected: true,
              customerVisible: true,
              taxable: Boolean(record.taxable),
              source: String(record.source || "manual"),
            };
          })
      : [];

    return {
      estimate: {
        id: estimateId,
        organizationId: String(estimate.organizationId || estimate.orgId || ""),
        jobId: String(estimate.jobId || ""),
        number: String(estimate.number || "Estimate"),
        version: Number(estimate.version || 1),
        status: estimate.status === "sent" ? "viewed" : estimate.status,
        documentType: "estimate",
        projectTitle: String(estimate.projectTitle || "Roofing project"),
        scopeSummary: String(estimate.scopeSummary || ""),
        issueDate: estimate.issueDate || null,
        validUntil: estimate.validUntil || null,
        customerSnapshot: estimate.customerSnapshot || {},
        propertyAddressSnapshot: estimate.propertyAddressSnapshot || null,
        organizationSnapshot: estimate.organizationSnapshot || {
          name: "Roger's Roofing",
        },
        lineItems: publicLineItems,
        subtotalCents: Number(estimate.subtotalCents || 0),
        discountCents: Number(estimate.discountCents || 0),
        taxCents: Number(estimate.taxCents || 0),
        taxRatePercent: Number(estimate.taxRatePercent || 0),
        totalCents: Number(estimate.totalCents || 0),
        depositCents: Number(estimate.depositCents || 0),
        paymentTerms: String(estimate.paymentTerms || ""),
        warrantyText: String(estimate.warrantyText || ""),
        notes: String(estimate.notes || ""),
        assumptions: Array.isArray(estimate.assumptions)
          ? estimate.assumptions.map(String)
          : [],
        exclusions: Array.isArray(estimate.exclusions)
          ? estimate.exclusions.map(String)
          : [],
      },
    };
  }
);

