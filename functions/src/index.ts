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
import {
  buildEstimateSnapshot,
  estimateSnapshotHash,
  publicEstimateFromSnapshot,
  type EstimateSnapshot,
} from "./estimateSnapshot.js";

const RESEND_API_KEY = defineSecret("RESEND_API_KEY");
const INVITE_FROM_EMAIL = defineSecret("INVITE_FROM_EMAIL");
const APP_BASE_URL = defineSecret("APP_BASE_URL");
const LEAD_NOTIFICATION_EMAIL = "rogersroofing23@gmail.com";

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

const leadServiceLabels: Record<string, string> = {
  roof_replacement: "Roof replacement",
  roof_repair: "Roof repair or leak",
  storm_damage: "Storm damage",
  new_construction: "New construction",
  inspection: "Roof inspection",
  commercial_roofing: "Commercial roofing",
  gutters: "Gutters or drainage",
  other: "Something else",
};

const leadUrgencyLabels: Record<string, string> = {
  emergency: "Active leak / urgent",
  within_week: "Within a week",
  within_month: "Within a month",
  planning: "Planning ahead",
};

const leadContactLabels: Record<string, string> = {
  phone: "Phone call",
  text: "Text message",
  email: "Email",
};

function leadEmailShell(content: string): string {
  return `
    <!doctype html>
    <html lang="en">
      <body style="margin:0;background:#f4f2ee;font-family:Arial,Helvetica,sans-serif;color:#24231f;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f2ee;padding:32px 16px;">
          <tr>
            <td align="center">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#ffffff;border:1px solid #ded9d1;border-radius:12px;overflow:hidden;">
                <tr>
                  <td style="padding:28px 32px 22px;border-bottom:1px solid #e4dfd8;">
                    <p style="margin:0 0 6px;font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#6b665f;">Roger's Roofing</p>
                    <p style="margin:0;font-size:22px;font-weight:700;line-height:1.25;color:#20201d;">Professional roofing. Clear communication.</p>
                  </td>
                </tr>
                <tr><td style="padding:30px 32px;">${content}</td></tr>
                <tr>
                  <td style="padding:20px 32px;border-top:1px solid #e4dfd8;background:#faf9f7;color:#69645e;font-size:12px;line-height:1.6;">
                    Roger's Roofing &amp; Contracting LLC<br />
                    <a href="mailto:rogersroofing23@gmail.com" style="color:#34322f;text-decoration:none;">rogersroofing23@gmail.com</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>`;
}

function leadDetailRow(label: string, value: string): string {
  return `
    <tr>
      <td style="width:36%;padding:10px 0;border-bottom:1px solid #ece8e2;color:#77716a;font-size:12px;vertical-align:top;">${escapeEmailHtml(label)}</td>
      <td style="padding:10px 0;border-bottom:1px solid #ece8e2;color:#292824;font-size:13px;font-weight:600;line-height:1.45;vertical-align:top;">${escapeEmailHtml(value)}</td>
    </tr>`;
}

type WebsiteLeadEmailDetails = {
  requestNumber: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address: string;
  service: string;
  urgency: string;
  preferredContact: string;
  message: string;
  insuranceClaimStarted: boolean;
  receivedAt: Date;
};

async function sendWebsiteLeadEmails(details: WebsiteLeadEmailDetails) {
  const resend = getResend();
  const from = (
    INVITE_FROM_EMAIL.value() ||
    "Roger's Roofing <no-reply@rogersroofingtx.com>"
  ).trim();
  const customerName = `${details.firstName} ${details.lastName}`;
  const subjectCustomerName = customerName.replace(/[\r\n]+/g, " ");
  const serviceLabel = leadServiceLabels[details.service] || details.service;
  const urgencyLabel = leadUrgencyLabels[details.urgency] || details.urgency;
  const contactLabel =
    leadContactLabels[details.preferredContact] || details.preferredContact;
  const receivedLabel = details.receivedAt.toLocaleString("en-US", {
    timeZone: "America/Chicago",
    dateStyle: "long",
    timeStyle: "short",
  });
  const message = details.message || "No additional project notes were provided.";

  const adminHtml = leadEmailShell(`
    <p style="margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#69645e;">New website estimate request</p>
    <h1 style="margin:0 0 10px;font-size:25px;line-height:1.25;color:#20201d;">${escapeEmailHtml(customerName)} requested an estimate</h1>
    <p style="margin:0 0 24px;color:#625d57;font-size:14px;line-height:1.6;">Request <strong style="color:#292824;">${escapeEmailHtml(details.requestNumber)}</strong> was submitted ${escapeEmailHtml(receivedLabel)}.</p>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
      ${leadDetailRow("Service", serviceLabel)}
      ${leadDetailRow("Timing", urgencyLabel)}
      ${leadDetailRow("Property address", details.address)}
      ${leadDetailRow("Customer", customerName)}
      ${leadDetailRow("Email", details.email)}
      ${leadDetailRow("Phone", details.phone)}
      ${leadDetailRow("Preferred contact", contactLabel)}
      ${leadDetailRow("Insurance claim started", details.insuranceClaimStarted ? "Yes" : "No")}
    </table>
    <div style="margin-top:24px;padding:18px 20px;background:#f7f5f2;border:1px solid #e6e1da;border-radius:8px;">
      <p style="margin:0 0 7px;font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#69645e;">Project notes</p>
      <p style="margin:0;color:#373530;font-size:14px;line-height:1.6;white-space:pre-wrap;">${escapeEmailHtml(message)}</p>
    </div>
    <p style="margin:24px 0 0;color:#625d57;font-size:13px;line-height:1.6;">Reply directly to this email to contact ${escapeEmailHtml(details.firstName)} at ${escapeEmailHtml(details.email)}.</p>`);

  const customerHtml = leadEmailShell(`
    <p style="margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#69645e;">Estimate request received</p>
    <h1 style="margin:0 0 12px;font-size:25px;line-height:1.25;color:#20201d;">Thank you, ${escapeEmailHtml(details.firstName)}.</h1>
    <p style="margin:0 0 24px;color:#5f5a54;font-size:14px;line-height:1.65;">We received your request and our team will review the project details before contacting you by ${escapeEmailHtml(contactLabel.toLowerCase())}.</p>
    <div style="padding:18px 20px;background:#f7f5f2;border:1px solid #e6e1da;border-radius:8px;">
      <p style="margin:0 0 5px;color:#77716a;font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;">Request number</p>
      <p style="margin:0;color:#20201d;font-size:18px;font-weight:700;">${escapeEmailHtml(details.requestNumber)}</p>
    </div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:20px;">
      ${leadDetailRow("Service requested", serviceLabel)}
      ${leadDetailRow("Preferred timing", urgencyLabel)}
      ${leadDetailRow("Property address", details.address)}
      ${leadDetailRow("Preferred contact", contactLabel)}
      ${leadDetailRow("Email", details.email)}
      ${leadDetailRow("Phone", details.phone)}
      ${leadDetailRow("Insurance claim started", details.insuranceClaimStarted ? "Yes" : "No")}
    </table>
    ${details.message ? `
      <div style="margin-top:24px;padding:18px 20px;background:#f7f5f2;border:1px solid #e6e1da;border-radius:8px;">
        <p style="margin:0 0 7px;font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#69645e;">Your project notes</p>
        <p style="margin:0;color:#373530;font-size:14px;line-height:1.6;white-space:pre-wrap;">${escapeEmailHtml(details.message)}</p>
      </div>` : ""}
    <div style="margin-top:24px;">
      <p style="margin:0 0 8px;font-size:13px;font-weight:700;color:#292824;">What happens next</p>
      <p style="margin:0;color:#625d57;font-size:13px;line-height:1.65;">A member of the Roger's Roofing team will review your request and contact you to discuss the property, answer questions, and coordinate an inspection when needed. Please keep the request number above for your records.</p>
    </div>
    <p style="margin:24px 0 0;color:#625d57;font-size:13px;line-height:1.65;">Need to add something? Reply to this email and our team will receive your message.</p>`);

  const adminText = [
    "New website estimate request",
    `Request: ${details.requestNumber}`,
    `Submitted: ${receivedLabel}`,
    `Customer: ${customerName}`,
    `Service: ${serviceLabel}`,
    `Timing: ${urgencyLabel}`,
    `Address: ${details.address}`,
    `Email: ${details.email}`,
    `Phone: ${details.phone}`,
    `Preferred contact: ${contactLabel}`,
    `Insurance claim started: ${details.insuranceClaimStarted ? "Yes" : "No"}`,
    `Project notes: ${message}`,
  ].join("\n");
  const customerText = [
    `Thank you, ${details.firstName}. We received your estimate request.`,
    `Request number: ${details.requestNumber}`,
    `Service requested: ${serviceLabel}`,
    `Preferred timing: ${urgencyLabel}`,
    `Property address: ${details.address}`,
    `Preferred contact: ${contactLabel}`,
    "A member of the Roger's Roofing team will review your request and contact you to discuss next steps.",
    "Reply to this email if you need to add any information.",
  ].join("\n");

  return Promise.allSettled([
    resend.emails.send({
      from,
      to: [LEAD_NOTIFICATION_EMAIL],
      replyTo: details.email,
      subject: `New estimate request: ${subjectCustomerName} - ${serviceLabel}`,
      html: adminHtml,
      text: adminText,
    }),
    resend.emails.send({
      from,
      to: [details.email],
      replyTo: LEAD_NOTIFICATION_EMAIL,
      subject: `We received your estimate request - ${details.requestNumber}`,
      html: customerHtml,
      text: customerText,
    }),
  ]);
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
  {
    region: "us-central1",
    secrets: [RESEND_API_KEY, INVITE_FROM_EMAIL],
  },
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
    const normalizedPreferredContact = ["phone", "text", "email"].includes(
      preferredContact
    )
      ? preferredContact
      : "phone";
    const normalizedUrgency = [
      "emergency",
      "within_week",
      "within_month",
      "planning",
    ].includes(urgency)
      ? urgency
      : "within_month";

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
      preferredContact: normalizedPreferredContact,
      propertyAddress: {
        fullLine: address,
        country: "US",
      },
      service,
      propertyType: cleanLeadText(data.propertyType, 40) || "residential",
      urgency: normalizedUrgency,
      message,
      insuranceClaimStarted: Boolean(data.insuranceClaimStarted),
      consentToContact: true,
      source: "website",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    let adminEmailSent = false;
    let customerEmailSent = false;
    let adminEmailResendId: string | null = null;
    let customerEmailResendId: string | null = null;

    try {
      const [adminEmailResult, customerEmailResult] =
        await sendWebsiteLeadEmails({
          requestNumber,
          firstName,
          lastName,
          email,
          phone,
          address,
          service,
          urgency: normalizedUrgency,
          preferredContact: normalizedPreferredContact,
          message,
          insuranceClaimStarted: Boolean(data.insuranceClaimStarted),
          receivedAt,
        });

      adminEmailSent =
        adminEmailResult.status === "fulfilled" &&
        !adminEmailResult.value.error;
      customerEmailSent =
        customerEmailResult.status === "fulfilled" &&
        !customerEmailResult.value.error;
      adminEmailResendId =
        adminEmailResult.status === "fulfilled"
          ? adminEmailResult.value.data?.id || null
          : null;
      customerEmailResendId =
        customerEmailResult.status === "fulfilled"
          ? customerEmailResult.value.data?.id || null
          : null;

      if (!adminEmailSent) {
        console.error(
          "Failed to send website lead notification:",
          adminEmailResult.status === "rejected"
            ? adminEmailResult.reason
            : adminEmailResult.value.error
        );
      }
      if (!customerEmailSent) {
        console.error(
          "Failed to send website lead confirmation:",
          customerEmailResult.status === "rejected"
            ? customerEmailResult.reason
            : customerEmailResult.value.error
        );
      }
    } catch (emailSetupError) {
      console.error("Website lead email delivery could not start:", emailSetupError);
    }

    try {
      await leadRef.update({
        emailDelivery: {
          admin: {
            status: adminEmailSent ? "sent" : "failed",
            recipient: LEAD_NOTIFICATION_EMAIL,
            resendId: adminEmailResendId,
          },
          customer: {
            status: customerEmailSent ? "sent" : "failed",
            recipient: email,
            resendId: customerEmailResendId,
          },
          attemptedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    } catch (auditError) {
      console.error("Failed to record website lead email delivery:", auditError);
    }

    return {
      ok: true,
      leadId: leadRef.id,
      requestNumber,
      status: "new",
      confirmationEmailSent: customerEmailSent,
      confirmationEmail: email,
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

function buildEstimateLink(
  estimateId: string,
  publicToken: string,
  version: number
): string {
  const baseUrl = (APP_BASE_URL.value() || "").replace(/\/$/, "");
  return `${baseUrl}/estimate/${encodeURIComponent(estimateId)}?token=${encodeURIComponent(publicToken)}&version=${version}`;
}

function estimateVersionId(version: number): string {
  return `v${String(version).padStart(4, "0")}`;
}

function safeStorageSegment(value: unknown, fallback: string): string {
  const cleaned = String(value || fallback)
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || fallback;
}

type PreparedEstimateVersion = {
  version: number;
  contentHash: string;
  publicToken: string;
  snapshot: EstimateSnapshot;
  versionRef: FirebaseFirestore.DocumentReference;
  reused: boolean;
  pdfStoragePath?: string;
  pdfFilename?: string;
};

async function prepareEstimateVersion(
  estimateId: string
): Promise<PreparedEstimateVersion> {
  const db = admin.firestore();
  const estimateRef = db.doc(`estimates/${estimateId}`);

  return db.runTransaction(async (transaction) => {
    const current = await transaction.get(estimateRef);
    if (!current.exists) {
      throw new HttpsError("not-found", "Estimate not found.");
    }
    const estimate = current.data() as Record<string, unknown>;
    const snapshot = buildEstimateSnapshot(estimateId, estimate);
    const contentHash = estimateSnapshotHash(snapshot);
    const latestVersion = Math.max(0, Number(estimate.latestVersion || 0));
    const latestHash = String(estimate.latestVersionContentHash || "");

    if (latestVersion > 0 && latestHash === contentHash) {
      const versionRef = estimateRef
        .collection("versions")
        .doc(estimateVersionId(latestVersion));
      const existingVersion = await transaction.get(versionRef);
      if (existingVersion.exists) {
        const data = existingVersion.data() as Record<string, unknown>;
        const savedSnapshot = asRecord(data.snapshot);
        return {
          version: latestVersion,
          contentHash,
          publicToken: String(data.publicToken || estimate.publicToken || ""),
          snapshot:
            Object.keys(savedSnapshot).length > 0 ? savedSnapshot : snapshot,
          versionRef,
          reused: true,
          pdfStoragePath: data.pdfStoragePath
            ? String(data.pdfStoragePath)
            : undefined,
          pdfFilename: data.pdfFilename ? String(data.pdfFilename) : undefined,
        };
      }
    }

    const version = latestVersion + 1 || 1;
    const publicToken = randomUUID();
    const versionRef = estimateRef
      .collection("versions")
      .doc(estimateVersionId(version));
    const now = admin.firestore.FieldValue.serverTimestamp();

    transaction.set(versionRef, {
      estimateId,
      organizationId: String(estimate.organizationId || estimate.orgId || ""),
      jobId: String(estimate.jobId || ""),
      number: String(estimate.number || "Estimate"),
      version,
      status: "preparing",
      contentHash,
      publicToken,
      snapshot,
      createdAt: now,
      updatedAt: now,
    });
    transaction.set(
      estimateRef,
      {
        version,
        latestVersion: version,
        latestVersionContentHash: contentHash,
        publicToken,
        publicVersion: version,
        frozenSnapshotHash: contentHash,
        updatedAt: now,
      },
      { merge: true }
    );

    return {
      version,
      contentHash,
      publicToken,
      snapshot,
      versionRef,
      reused: false,
    };
  });
}

let estimateLogoPromise: Promise<Buffer | undefined> | undefined;

function estimateLogo(): Promise<Buffer | undefined> {
  estimateLogoPromise ??= fs
    .readFile(path.resolve(__dirname, "../assets/rogers-logo-separated-v3.png"))
    .catch((error: unknown) => {
      console.warn("Estimate PDF logo could not be loaded:", error);
      return undefined;
    });
  return estimateLogoPromise;
}

async function ensureEstimatePdf(
  estimateId: string,
  prepared: PreparedEstimateVersion
): Promise<{ buffer: Buffer; storagePath: string; filename: string }> {
  const organizationId = safeStorageSegment(
    prepared.snapshot.organizationId || prepared.snapshot.orgId,
    "organization"
  );
  const jobId = safeStorageSegment(prepared.snapshot.jobId, "job");
  const estimateNumber = safeStorageSegment(
    prepared.snapshot.number,
    "estimate"
  );
  const filename =
    prepared.pdfFilename || `${estimateNumber}-v${prepared.version}.pdf`;
  const storagePath =
    prepared.pdfStoragePath ||
    `organizations/${organizationId}/jobs/${jobId}/estimates/${safeStorageSegment(
      estimateId,
      "estimate"
    )}/versions/v${prepared.version}/${filename}`;
  const file = admin.storage().bucket().file(storagePath);
  const [exists] = await file.exists();

  let buffer: Buffer;
  if (exists) {
    [buffer] = await file.download();
  } else {
    // PDFKit is intentionally loaded only when a snapshot must be generated.
    // Keeping it out of module initialization prevents Firebase's deployment
    // discovery process from timing out on slower Windows/OneDrive workspaces.
    const { renderEstimatePdf } = await import("./estimatePdf.js");
    buffer = await renderEstimatePdf(prepared.snapshot, {
      version: prepared.version,
      logo: await estimateLogo(),
    });
    await file.save(buffer, {
      resumable: false,
      contentType: "application/pdf",
      metadata: {
        cacheControl: "private, no-store, max-age=0",
        contentDisposition: `attachment; filename="${filename}"`,
        metadata: {
          estimateId,
          version: String(prepared.version),
          contentHash: prepared.contentHash,
          visibility: "private",
        },
      },
    });
  }

  await prepared.versionRef.set(
    {
      status: "generated",
      pdfStoragePath: storagePath,
      pdfFilename: filename,
      pdfSizeBytes: buffer.length,
      pdfGeneratedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return { buffer, storagePath, filename };
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

    const initialSnapshot = buildEstimateSnapshot(estimateId, estimate);
    const requestedContentHash = estimateSnapshotHash(initialSnapshot);
    const lastSent = timestampDate(estimate.lastEmailSentAt);
    const latestIssuedVersion = Number(estimate.latestIssuedVersion || 0);
    if (
      lastSent &&
      Date.now() - lastSent.getTime() < 2 * 60 * 1000 &&
      estimate.lastEmailContentHash === requestedContentHash &&
      latestIssuedVersion > 0
    ) {
      const versionSnapshot = await estimateRef
        .collection("versions")
        .doc(estimateVersionId(latestIssuedVersion))
        .get();
      const versionData = versionSnapshot.data() || {};
      const publicToken = String(versionData.publicToken || "");
      return {
        ok: true,
        skipped: true,
        reason: "recently_sent",
        version: latestIssuedVersion,
        publicUrl: publicToken
          ? buildEstimateLink(estimateId, publicToken, latestIssuedVersion)
          : undefined,
      };
    }

    const inFlight = timestampDate(estimate.emailSendInFlightAt);
    if (inFlight && Date.now() - inFlight.getTime() < 2 * 60 * 1000) {
      if (estimate.emailSendContentHash === requestedContentHash) {
        return { ok: true, skipped: true, reason: "in_flight" };
      }
      throw new HttpsError(
        "aborted",
        "Another estimate version is currently being prepared. Try again shortly."
      );
    }

    await estimateRef.set(
      {
        emailSendInFlightAt: admin.firestore.FieldValue.serverTimestamp(),
        emailSendContentHash: requestedContentHash,
      },
      { merge: true }
    );

    let prepared: PreparedEstimateVersion | undefined;
    try {
      prepared = await prepareEstimateVersion(estimateId);
      if (!prepared.publicToken) {
        throw new HttpsError(
          "internal",
          "The estimate version could not be secured for delivery."
        );
      }
      const pdf = await ensureEstimatePdf(estimateId, prepared);
      const estimateUrl = buildEstimateLink(
        estimateId,
        prepared.publicToken,
        prepared.version
      );
      const currentEstimate = prepared.snapshot;
      const currentCustomer = asRecord(currentEstimate.customerSnapshot);
      const currentOrganization = asRecord(
        currentEstimate.organizationSnapshot
      );
      const rawNumber = String(currentEstimate.number || "Estimate");
      const number = escapeEmailHtml(rawNumber);
      const customerName = escapeEmailHtml(
        currentCustomer.name || customer.name || "there"
      );
      const rawBusinessName = String(
        currentOrganization.legalName ||
          currentOrganization.name ||
          organization.legalName ||
          organization.name ||
          "Roger's Roofing"
      );
      const businessName = escapeEmailHtml(rawBusinessName);
      const total = (
        Number(currentEstimate.totalCents || 0) / 100
      ).toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
      });
      const roofAreaSquareFeet = Number(
        currentEstimate.roofAreaSquareFeet || 0
      );
      const roofAreaSummary =
        roofAreaSquareFeet > 0
          ? `<p style="margin:0 0 22px;padding:12px 14px;border:1px solid #ddd6cc;border-radius:8px;background:#faf8f5;color:#5f5a54;font-size:13px;line-height:1.5;">Measured roof area: <strong style="color:#24231f;">${escapeEmailHtml(
              `${roofAreaSquareFeet.toLocaleString("en-US", {
                maximumFractionDigits: 2,
              })} sq. ft.`
            )}</strong></p>`
          : "";
      const resend = getResend();
      const from = (
        INVITE_FROM_EMAIL.value() ||
        "Roger's Roofing <no-reply@rogersroofingtx.com>"
      ).trim();
      const subject = `${rawNumber} (Version ${prepared.version}) from ${rawBusinessName}`;
      const html = `
        <div style="background:#f4f1ec;padding:32px 16px;font-family:Arial,Helvetica,sans-serif;color:#24231f;">
          <div style="max-width:620px;margin:0 auto;background:#ffffff;border:1px solid #ddd6cc;border-top:6px solid #b71920;border-radius:10px;padding:34px;">
            <p style="margin:0 0 8px;color:#b71920;font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;">Professional roofing estimate</p>
            <h1 style="margin:0 0 20px;font-family:Georgia,serif;font-size:32px;font-weight:400;">${number}</h1>
            <p style="margin:0 0 12px;line-height:1.6;">Hello ${customerName},</p>
            <p style="margin:0 0 22px;line-height:1.6;color:#5f5a54;">${businessName} prepared Version ${prepared.version} of your itemized roofing estimate. The estimate total is <strong style="color:#24231f;">${escapeEmailHtml(total)}</strong>.</p>
            ${roofAreaSummary}
            <p style="margin:0 0 24px;"><a href="${estimateUrl}" style="display:inline-block;background:#b71920;color:#ffffff;text-decoration:none;border-radius:7px;padding:13px 18px;font-weight:700;">View estimate</a></p>
            <p style="margin:0;color:#817a72;font-size:12px;line-height:1.5;">The private link includes the complete estimate and a print / download option. A PDF snapshot of this exact version is also attached for your convenience. Reply to this email if you have any questions.</p>
          </div>
        </div>
      `;

      const { data, error } = await resend.emails.send({
        from,
        to: [email],
        subject,
        html,
        attachments: [
          {
            filename: pdf.filename,
            content: pdf.buffer,
            contentType: "application/pdf",
          },
        ],
      });
      if (error) {
        throw new HttpsError(
          "internal",
          error.message || "Failed to send estimate email."
        );
      }

      const sentAt = admin.firestore.FieldValue.serverTimestamp();
      const batch = db.batch();
      batch.set(
        prepared.versionRef,
        {
          status: "sent",
          sentAt,
          sentTo: email,
          resendEmailId: data?.id || null,
          pdfStoragePath: pdf.storagePath,
          pdfFilename: pdf.filename,
          updatedAt: sentAt,
        },
        { merge: true }
      );
      batch.set(
        estimateRef,
        {
          status: "sent",
          version: prepared.version,
          sentAt: estimate.sentAt || sentAt,
          lastEmailSentAt: sentAt,
          lastEmailResendId: data?.id || null,
          lastEmailContentHash: prepared.contentHash,
          latestIssuedVersion: prepared.version,
          latestIssuedContentHash: prepared.contentHash,
          latestIssuedPdfStoragePath: pdf.storagePath,
          publicToken: prepared.publicToken,
          publicVersion: prepared.version,
          emailSendInFlightAt: admin.firestore.FieldValue.delete(),
          emailSendContentHash: admin.firestore.FieldValue.delete(),
          updatedAt: sentAt,
        },
        { merge: true }
      );
      await batch.commit();

      return {
        ok: true,
        id: data?.id || null,
        publicUrl: estimateUrl,
        version: prepared.version,
        reusedVersion: prepared.reused,
        pdfAttached: true,
      };
    } catch (error) {
      if (prepared) {
        await prepared.versionRef.set(
          {
            status: "delivery_failed",
            deliveryFailedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }
      await estimateRef.set(
        {
          emailSendInFlightAt: admin.firestore.FieldValue.delete(),
          emailSendContentHash: admin.firestore.FieldValue.delete(),
        },
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
    const requestedVersion = Number(request.data?.version || 0);
    if (!estimateId || !token) {
      throw new HttpsError("invalid-argument", "Invalid estimate link.");
    }

    const estimateRef = admin.firestore().doc(`estimates/${estimateId}`);
    const snapshot = await estimateRef.get();
    if (!snapshot.exists) {
      throw new HttpsError("not-found", "Estimate not found.");
    }
    const estimate = snapshot.data() as Record<string, unknown>;
    const version =
      Number.isInteger(requestedVersion) && requestedVersion > 0
        ? requestedVersion
        : Number(estimate.latestIssuedVersion || estimate.publicVersion || 0);

    if (version > 0) {
      const versionRef = estimateRef
        .collection("versions")
        .doc(estimateVersionId(version));
      const versionSnapshot = await versionRef.get();
      if (versionSnapshot.exists) {
        const versionData = versionSnapshot.data() as Record<string, unknown>;
        const versionStatus = String(versionData.status || "");
        if (
          versionData.publicToken !== token ||
          !["sent", "viewed"].includes(versionStatus)
        ) {
          throw new HttpsError("permission-denied", "Invalid estimate link.");
        }
        const issuedSnapshot = asRecord(versionData.snapshot);
        const now = admin.firestore.FieldValue.serverTimestamp();
        const batch = admin.firestore().batch();
        batch.set(
          versionRef,
          { status: "viewed", viewedAt: now, updatedAt: now },
          { merge: true }
        );
        if (Number(estimate.latestIssuedVersion || 0) === version) {
          batch.set(
            estimateRef,
            { status: "viewed", viewedAt: now, updatedAt: now },
            { merge: true }
          );
        }
        await batch.commit();
        return {
          estimate: publicEstimateFromSnapshot(
            estimateId,
            issuedSnapshot,
            version,
            "viewed"
          ),
        };
      }
    }

    // Legacy links created before immutable versions were introduced remain
    // usable. New deliveries always resolve through a version snapshot above.
    if (!estimate.publicToken || estimate.publicToken !== token) {
      throw new HttpsError("permission-denied", "Invalid estimate link.");
    }
    const legacyVersion = Number(estimate.version || 1);
    const now = admin.firestore.FieldValue.serverTimestamp();
    await estimateRef.set(
      { status: "viewed", viewedAt: now, updatedAt: now },
      { merge: true }
    );
    return {
      estimate: publicEstimateFromSnapshot(
        estimateId,
        buildEstimateSnapshot(estimateId, estimate),
        legacyVersion,
        "viewed"
      ),
    };
  }
);

