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
    // Auth guard (so random people can’t spam emails)
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

    // Pull the invoice
    const invSnap = await db.doc(`invoices/${invoiceId}`).get();
    
    if (!invSnap.exists) {
      throw new HttpsError("not-found", "Invoice not found.");
    }

    const invoice = invSnap.data() as any;

    // IMPORTANT: multi-tenant safety
    // Your InvoicesPage writes `orgId` into invoice docs.
    // If old invoices don’t have it yet, you can decide whether to block or allow.
    const invoiceOrgId = String(invoice.orgId || "").trim();
    if (!invoiceOrgId) {
      throw new HttpsError(
        "failed-precondition",
        "Invoice missing orgId. Re-save invoice with latest schema."
      );
    }

    // Verify caller belongs to that org (best-effort without your full auth model):
    // This assumes you store orgId on an employee doc keyed by uid OR a user doc keyed by uid.
    // Try both patterns; keep whichever matches your actual schema.
    const uid = request.auth.uid;

    // Pattern A: users/{uid}.orgId
    const userSnap = await db.doc(`users/${uid}`).get();
    const userOrgId = userSnap.exists ? String((userSnap.data() as any).orgId || "") : "";

    // Pattern B: employees where userId == uid (fallback)
    let employeeOrgId = "";
    if (!userOrgId) {
      const empQ = await db.collection("employees").where("userId", "==", uid).limit(1).get();
      if (!empQ.empty) employeeOrgId = String((empQ.docs[0].data() as any).orgId || "");
    }

    const callerOrgId = userOrgId || employeeOrgId;
    if (!callerOrgId || callerOrgId !== invoiceOrgId) {
      throw new HttpsError("permission-denied", "Not allowed to send this invoice.");
    }

    const resend = getResend();

    const from = INVITE_FROM_EMAIL.value();
    const appBase = APP_BASE_URL.value();

    if (!from) throw new HttpsError("failed-precondition", "Missing INVITE_FROM_EMAIL secret.");
    if (!appBase) throw new HttpsError("failed-precondition", "Missing APP_BASE_URL secret.");

    const number = invoice.number || "Invoice";
    const totalCents = Number(invoice.money?.totalCents || 0);
    const total = (totalCents / 100).toLocaleString(undefined, {
      style: "currency",
      currency: "USD",
    });

    // Ensure the invoice has a publicToken and build the public viewer link
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

    const { data, error } = await resend.emails.send({
      from,
      to: [email], // keep consistent with your invite sender
      subject,
      html,
    });
    
    if (error) {
      console.error("Resend invoice send error:", error);
      throw new HttpsError("internal", error.message || "Failed to send invoice email.");
    }

    // Record when the invoice was emailed for audit/resend purposes.  Mirror the behavior
    // used for employee invites by writing a timestamp into the invoice document.  This
    // allows automatic triggers to skip duplicates when the invoice is first created.
    try {
      const now = admin.firestore.FieldValue.serverTimestamp();
      await db.doc(`invoices/${invoiceId}`).set(
        {
          lastEmailSentAt: now,
        },
        { merge: true }
      );
    } catch (err) {
      console.error("Failed to update invoice with lastEmailSentAt:", err);
    }
    
    return { ok: true, id: data?.id || null };
    
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

