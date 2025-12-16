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