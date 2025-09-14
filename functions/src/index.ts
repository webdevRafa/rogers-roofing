// functions/src/index.ts
import { onObjectFinalized } from "firebase-functions/v2/storage";
import { onDocumentDeleted } from "firebase-functions/v2/firestore";
import { setGlobalOptions } from "firebase-functions/v2/options";
import * as admin from "firebase-admin";
import * as path from "path";
import * as os from "os";
import * as fs from "fs/promises";
import sharp from "sharp";
import { randomUUID } from "node:crypto";

admin.initializeApp();
setGlobalOptions({ region: "us-central1", memory: "1GiB", timeoutSeconds: 540 });

/**
 * 1) Convert uploads at jobs/{jobId}/attachments/* to WEBP (q=90),
 *    write a doc in jobPhotos, bump counters on the job, delete original.
 */
export const processJobPhoto = onObjectFinalized(async (event) => {
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
    await sharp(tempOriginal).webp({ quality: 90 }).toFile(tempWebp);

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
