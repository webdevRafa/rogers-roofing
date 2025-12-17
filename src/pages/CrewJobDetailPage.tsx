import { useEffect, useState, useRef } from "react";
import { useParams } from "react-router-dom";
import {
  doc,
  updateDoc,
  serverTimestamp,
  arrayUnion,
  onSnapshot,
  collection,
  query,
  where,
  orderBy,
  Timestamp,
  deleteDoc,
} from "firebase/firestore";

import { db } from "../firebase/firebaseConfig";
import { motion, type MotionProps } from "framer-motion";
import {
  Plus,
  X,
  Camera,
  Image as ImageIcon,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";

import { getStorage, ref as storageRef, uploadBytes } from "firebase/storage";

import { useCurrentEmployee } from "../hooks/useCurrentEmployee";
import type { Job, Note } from "../types/types";

/**
 * CrewJobDetailPage shows a simplified job detail view for crew members and
 * managers. It displays address and task schedules/completion status.
 * Crew can mark tasks as completed and add notes. A photos section allows
 * crew to view and upload job photos. All updates use Firestore timestamps
 * where appropriate. Photos are stored in Cloud Storage and surfaced via a
 * Cloud Function which writes to the jobPhotos collection.
 */

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];
const fadeUp = (delay = 0): Partial<MotionProps> => ({
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.35, ease: EASE, delay },
});

const item: MotionProps["variants"] = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
};

// Firestore timestamp helpers copied from original page
type FsTimestampLike = { toDate: () => Date };
function isFsTimestamp(x: unknown): x is FsTimestampLike {
  return typeof (x as FsTimestampLike)?.toDate === "function";
}
function toMillis(x: unknown): number | null {
  if (x == null) return null;
  let d: Date | null = null;
  if (isFsTimestamp(x)) d = x.toDate();
  else if (x instanceof Date) d = x;
  else if (typeof x === "string" || typeof x === "number") {
    const parsed = new Date(x);
    if (!Number.isNaN(parsed.getTime())) d = parsed;
  }
  return d ? d.getTime() : null;
}
function fmtDate(x: unknown): string {
  const ms = toMillis(x);
  return ms == null ? "—" : new Date(ms).toLocaleString();
}

// Type for photos listened from the jobPhotos collection
type JobPhoto = {
  id: string;
  jobId: string;
  url: string;
  caption?: string;
  createdAt?: any;
};

const LIST_MAX_H = "max-h-[360px]";

function MotionCard({
  title,
  right,
  delay = 0,
  children,
}: {
  title: string;
  right?: React.ReactNode;
  delay?: number;
  children: React.ReactNode;
}) {
  return (
    <motion.section
      {...fadeUp(delay)}
      className="rounded-2xl bg-white/50 hover:bg-white transition duration-300 ease-in-out p-6 shadow ring-1 ring-black/5"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-[var(--color-text)]">
          {title}
        </h2>
        {right}
      </div>
      {children}
    </motion.section>
  );
}

function ModalShell({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-xl rounded-2xl bg-white p-5 shadow-xl">
        <div className="flex items-center justify-between gap-3">
          <div className="text-lg font-semibold text-[var(--color-text)]">
            {title}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[var(--color-border)] bg-white/80 hover:bg-[var(--color-card-hover)] transition"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}

export default function CrewJobDetailPage() {
  const { employee } = useCurrentEmployee();
  const { id } = useParams<{ id: string }>();
  const [job, setJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");
  const [noteModalOpen, setNoteModalOpen] = useState(false);

  // Photos state
  const [photos, setPhotos] = useState<JobPhoto[]>([]);
  const [photoModalOpen, setPhotoModalOpen] = useState(false);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoCaption, setPhotoCaption] = useState("");
  const [uploading, setUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  // Generic toast (same UX/UI as JobDetailPage)
  type ToastStatus = "success" | "error";
  type ToastState = {
    status: ToastStatus;
    title: string;
    message: string;
  } | null;

  const [toast, setToast] = useState<ToastState>(null);

  // Auto-hide global toast
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(id);
  }, [toast]);

  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(0);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const galleryInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!id) return;
    const ref = doc(db, "jobs", id);
    const unsub = onSnapshot(
      ref,
      (snap) => {
        if (!snap.exists()) {
          setJob(null);
          setError("Job not found");
          setLoading(false);
          return;
        }
        setJob({ id: snap.id, ...(snap.data() as Omit<Job, "id">) });
        setLoading(false);
      },
      (err) => {
        console.error(err);
        setError(err.message || "Failed to load job.");
        setJob(null);
        setLoading(false);
      }
    );
    return () => unsub();
  }, [id]);

  // Real-time listener for job photos
  useEffect(() => {
    if (!id) return;
    const photosRef = collection(db, "jobPhotos");
    const q = query(
      photosRef,
      where("jobId", "==", id),
      orderBy("createdAt", "desc")
    );
    const unsub = onSnapshot(
      q,
      (qs) => {
        const list: JobPhoto[] = [];
        qs.forEach((d) => list.push({ id: d.id, ...(d.data() as any) }));
        setPhotos(list);
      },
      (err) => {
        console.error("Failed to listen to photos", err);
      }
    );
    return () => unsub();
  }, [id]);

  // Generate preview URL for selected photo file
  useEffect(() => {
    if (!photoFile) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(photoFile);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [photoFile]);

  async function markCompleted(
    field: "feltCompletedAt" | "shinglesCompletedAt" | "punchedAt"
  ) {
    if (!job || !id) return;
    try {
      const ref = doc(db, "jobs", id);
      await updateDoc(ref, { [field]: serverTimestamp() });
      setToast({
        status: "success",
        title: "Marked complete",
        message:
          field === "feltCompletedAt"
            ? "DRY IN has been marked completed."
            : field === "shinglesCompletedAt"
            ? "Shingles have been marked completed."
            : "Punch has been marked completed.",
      });
    } catch (err) {
      console.error(err);
      setToast({
        status: "error",
        title: "Update failed",
        message: "Failed to mark as complete. Please try again.",
      });
    }
  }

  async function addNote() {
    if (!job || !id || !noteText.trim()) return;
    try {
      const ref = doc(db, "jobs", id);
      const newNote: Note = {
        id: Date.now().toString(),
        text: noteText.trim(),
        createdBy: employee?.id || null,
        createdAt: Timestamp.now() as any,
      };
      // Append the note using arrayUnion (serverTimestamp cannot be inside arrayUnion)
      await updateDoc(ref, { notes: arrayUnion(newNote) });
      setToast({
        status: "success",
        title: "Note added",
        message: "Your note was saved to the job.",
      });

      setNoteText("");
    } catch (err) {
      console.error(err);
      setToast({
        status: "error",
        title: "Note failed",
        message: "Could not save note. Please try again.",
      });
    }
  }

  // Upload photo to Storage. Cloud Function will create jobPhotos doc.
  async function uploadPhoto() {
    if (!job || !photoFile) return;
    setUploading(true);
    try {
      const storage = getStorage();
      const safeName = photoFile.name
        .replace(/\s+/g, "_")
        .replace(/[^\w.\-]/g, "");
      const filename = `${Date.now()}_${safeName}`;
      const path = `jobs/${job.id}/attachments/${filename}`;
      const fileRef = storageRef(storage, path);
      await uploadBytes(fileRef, photoFile, {
        contentType: photoFile.type || "image/*",
        customMetadata: {
          jobId: job.id,
          caption: photoCaption || "",
        },
      });
      setPhotoFile(null);
      setPhotoCaption("");
      setPhotoModalOpen(false);
      setToast({
        status: "success",
        title: "Photo upload received",
        message: "Upload received — processing. The photo will appear shortly.",
      });
    } catch (e) {
      console.error(e);
      setToast({
        status: "error",
        title: "Photo upload failed",
        message:
          "Upload failed. Please try again or check the console for details.",
      });
    } finally {
      setUploading(false);
    }
  }

  // Delete photo by removing its jobPhotos doc
  async function deletePhoto(photoId: string) {
    try {
      await deleteDoc(doc(db, "jobPhotos", photoId));
      setToast({
        status: "success",
        title: "Photo deleted",
        message: "The photo was removed from this job.",
      });
    } catch (e) {
      console.error(e);
      setToast({
        status: "error",
        title: "Delete failed",
        message: "Could not delete photo. Please try again.",
      });
    }
  }

  // Photo viewer navigation helpers
  function openViewer(idx: number) {
    setViewerIndex(idx);
    setViewerOpen(true);
  }
  function closeViewer() {
    setViewerOpen(false);
  }
  function prevPhoto() {
    if (photos.length === 0) return;
    setViewerIndex((i) => (i - 1 + photos.length) % photos.length);
  }
  function nextPhoto() {
    if (photos.length === 0) return;
    setViewerIndex((i) => (i + 1) % photos.length);
  }

  if (loading) {
    return <div className="py-10 text-center text-gray-500">Loading job…</div>;
  }
  if (error || !job) {
    return (
      <div className="py-10 text-center text-red-600">
        {error || "Job not found."}
      </div>
    );
  }
  const address = job.address?.fullLine || job.address?.street || "";
  const feltScheduled = job.feltScheduledFor;
  const feltCompleted = job.feltCompletedAt;
  const shinglesScheduled = job.shinglesScheduledFor;
  const shinglesCompleted = job.shinglesCompletedAt;
  const punchScheduled = job.punchScheduledFor;
  const punchCompleted = job.punchedAt;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Job Details</h1>
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="text-xl font-medium text-gray-900">
          {address || "Unassigned address"}
        </h2>
        <div className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
          <div>
            <strong>Status:</strong> {job.status}
          </div>
          <div>
            <strong>Felt:</strong>{" "}
            {feltCompleted ? (
              <span className="text-emerald-700">Completed</span>
            ) : feltScheduled ? (
              <span className="text-yellow-700">Scheduled</span>
            ) : (
              <span className="text-gray-600">Not scheduled</span>
            )}
            {!feltCompleted && feltScheduled && (
              <button
                onClick={() => markCompleted("feltCompletedAt")}
                className="ml-2 text-xs text-blue-600 underline"
              >
                Mark complete
              </button>
            )}
          </div>
          <div>
            <strong>Shingles:</strong>{" "}
            {shinglesCompleted ? (
              <span className="text-emerald-700">Completed</span>
            ) : shinglesScheduled ? (
              <span className="text-yellow-700">Scheduled</span>
            ) : (
              <span className="text-gray-600">Not scheduled</span>
            )}
            {!shinglesCompleted && shinglesScheduled && (
              <button
                onClick={() => markCompleted("shinglesCompletedAt")}
                className="ml-2 text-xs text-blue-600 underline"
              >
                Mark complete
              </button>
            )}
          </div>
          <div>
            <strong>Punch:</strong>{" "}
            {punchCompleted ? (
              <span className="text-emerald-700">Completed</span>
            ) : punchScheduled ? (
              <span className="text-yellow-700">Scheduled</span>
            ) : (
              <span className="text-gray-600">Not scheduled</span>
            )}
            {!punchCompleted && punchScheduled && (
              <button
                onClick={() => markCompleted("punchedAt")}
                className="ml-2 text-xs text-blue-600 underline"
              >
                Mark complete
              </button>
            )}
          </div>
        </div>
      </div>
      {/* Notes Section */}
      <MotionCard
        title="Notes"
        delay={0.15}
        right={
          <button
            type="button"
            onClick={() => setNoteModalOpen(true)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[var(--color-border)] bg-white/80 text-[var(--color-text)] hover:bg-[var(--color-card-hover)] transition"
            title="Add note"
          >
            <Plus className="h-4 w-4" />
          </button>
        }
      >
        <div
          className={`mt-3 ${LIST_MAX_H} overflow-y-auto overflow-x-hidden pr-1`}
        >
          <ul>
            {(job.notes ?? [])
              .slice()
              .reverse()
              .map((n) => (
                <motion.li
                  key={n.id}
                  className="mb-2 flex items-start gap-3 rounded-xl bg-white/70 p-3 ring-1 ring-black/5 hover:bg-white transition"
                  variants={item}
                  initial="initial"
                  animate="animate"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-[var(--color-text)] whitespace-pre-wrap break-words break-all mr-3">
                      {n.text}
                    </p>
                    <div className="mt-1 text-xs text-[var(--color-muted)]">
                      {fmtDate(n.createdAt)}
                    </div>
                  </div>
                </motion.li>
              ))}
            {(job.notes ?? []).length === 0 && (
              <li className="p-3 text-sm text-[var(--color-muted)]">
                No notes yet.
              </li>
            )}
          </ul>
        </div>
      </MotionCard>
      {/* Photos Section */}
      <MotionCard
        title="Photos"
        delay={0.2}
        right={
          <button
            type="button"
            onClick={() => setPhotoModalOpen(true)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[var(--color-border)] bg-white/80 text-[var(--color-text)] hover:bg-[var(--color-card-hover)] transition"
            title="Add photo"
          >
            <Plus className="h-4 w-4" />
          </button>
        }
      >
        <div className={`${LIST_MAX_H} overflow-y-auto pr-1`}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {photos.map((p, i) => (
              <motion.div
                key={p.id}
                className="group relative"
                variants={item}
                initial="initial"
                animate="animate"
              >
                <button
                  type="button"
                  onClick={() => openViewer(i)}
                  className="block w-full focus:outline-none"
                  aria-label="Open photo"
                  title="Open"
                >
                  <img
                    src={p.url}
                    alt={p.caption || ""}
                    className="h-32 w-full rounded-lg object-cover"
                    loading="lazy"
                  />
                </button>
                <button
                  onClick={() => deletePhoto(p.id)}
                  className="absolute right-2 top-2 rounded-full bg-black/60 px-2 py-1 text-xs text-white opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition"
                  title="Delete"
                >
                  Delete
                </button>
                {p.caption && (
                  <div className="absolute inset-x-0 bottom-0 rounded-b-lg bg-black/50 p-1 text-center text-[10px] text-white">
                    {p.caption}
                  </div>
                )}
              </motion.div>
            ))}
            {photos.length === 0 && (
              <div className="p-3 text-sm text-[var(--color-muted)]">
                No photos yet.
              </div>
            )}
          </div>
        </div>
      </MotionCard>
      <ModalShell
        open={noteModalOpen}
        title="Add Note"
        onClose={() => setNoteModalOpen(false)}
      >
        <textarea
          value={noteText}
          onChange={(e) => setNoteText(e.target.value)}
          rows={6}
          placeholder="Type your note…"
          className="w-full rounded-xl border border-[var(--color-border)] bg-white px-3 py-2 text-sm"
        />
        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => setNoteModalOpen(false)}
            className="rounded-xl border border-[var(--color-border)] bg-white px-4 py-2 text-sm hover:bg-[var(--color-card-hover)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={async () => {
              await addNote();
              setNoteModalOpen(false);
            }}
            disabled={!noteText.trim()}
            className="rounded-xl bg-[var(--color-brown)] px-4 py-2 text-sm text-white disabled:opacity-60"
          >
            Save note
          </button>
        </div>
      </ModalShell>
      {/* Photo upload modal */}
      <ModalShell
        open={photoModalOpen}
        title="Upload Photo"
        onClose={() => {
          setPhotoModalOpen(false);
          setPhotoFile(null);
          setPhotoCaption("");
        }}
      >
        <form
          className="grid w-full max-w-full grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_140px] sm:items-end"
          onSubmit={async (e) => {
            e.preventDefault();
            await uploadPhoto();
          }}
        >
          {/* CAMERA ONLY input */}
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(e) => {
              const file = e.target.files?.[0] ?? null;
              setPhotoFile(file);
            }}
            className="sr-only"
          />
          {/* GALLERY ONLY input */}
          <input
            ref={galleryInputRef}
            type="file"
            accept="image/*"
            onChange={(e) => {
              const file = e.target.files?.[0] ?? null;
              setPhotoFile(file);
            }}
            className="sr-only"
          />
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => cameraInputRef.current?.click()}
                className="inline-flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-white px-3 py-2 text-sm font-medium text-[var(--color-text)] shadow-sm hover:bg-[var(--color-card-hover)]"
              >
                <Camera className="h-4 w-4 text-[var(--color-primary)]" />
                <span>Camera</span>
              </button>
              <button
                type="button"
                onClick={() => galleryInputRef.current?.click()}
                className="inline-flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-white px-3 py-2 text-sm font-medium text-[var(--color-text)] shadow-sm hover:bg-[var(--color-card-hover)]"
              >
                <ImageIcon className="h-4 w-4 text-[var(--color-primary)]" />
                <span>Gallery</span>
              </button>
            </div>
            <div className="text-xs text-[var(--color-muted)] truncate max-w-full">
              {photoFile
                ? `Selected: ${photoFile.name}`
                : "Snap a picture or choose one from your gallery."}
            </div>
            {previewUrl && (
              <div>
                <div className="mb-1 text-xs text-[var(--color-muted)]">
                  Preview
                </div>
                <img
                  src={previewUrl}
                  alt="Selected preview"
                  className="h-28 w-full rounded-xl object-cover ring-1 ring-black/5"
                />
              </div>
            )}
            <input
              value={photoCaption}
              onChange={(e) => setPhotoCaption(e.target.value)}
              placeholder="Optional caption"
              className="h-10 w-full min-w-0 rounded-lg border border-[var(--color-border)] bg-white/80 px-3 text-sm outline-none focus:ring-2 focus:ring-[var(--color-accent)] shadow-sm"
            />
          </div>
          <div className="max-w-[80px] sm:w-auto">
            <button
              type="submit"
              disabled={uploading || !photoFile}
              className="h-8 inline-flex items-center justify-center rounded-md bg-[var(--color-brown)] px-4 text-sm font-medium text-white shadow-sm hover:bg-[var(--color-brown-hover)] transition disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {uploading ? "Uploading…" : "Upload"}
            </button>
          </div>
        </form>
      </ModalShell>

      {/* ===== Global Toast (same as JobDetailPage) ===== */}
      {toast && (
        <div className="fixed right-4 top-20 z-50">
          <div className="flex items-start gap-3 rounded-xl border border-[var(--color-border)] bg-white/95 px-4 py-3 text-sm shadow-lg">
            <div className="mt-0.5">
              {toast.status === "success" ? (
                <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              ) : (
                <AlertTriangle className="h-5 w-5 text-red-500" />
              )}
            </div>

            <div className="flex-1">
              <div
                className={
                  "font-semibold " +
                  (toast.status === "success"
                    ? "text-emerald-700"
                    : "text-red-600")
                }
              >
                {toast.title}
              </div>
              <div className="mt-0.5 text-xs text-[var(--color-muted)]">
                {toast.message}
              </div>
            </div>

            <button
              type="button"
              onClick={() => setToast(null)}
              className="ml-2 rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              aria-label="Dismiss"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Photo viewer overlay */}
      {viewerOpen && photos.length > 0 && (
        <div
          className="fixed inset-0 z-[90] bg-black/80 flex items-center justify-center p-4"
          aria-modal="true"
          role="dialog"
          onClick={(e) => {
            // close on backdrop click only (not when clicking image or buttons)
            if (e.target === e.currentTarget) closeViewer();
          }}
        >
          <button
            onClick={closeViewer}
            className="absolute right-4 top-4 rounded-full p-2 bg-white/10 hover:bg-white/20 text-white"
            aria-label="Close viewer"
            title="Close"
          >
            <X className="h-6 w-6" />
          </button>
          {photos.length > 1 && (
            <>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  prevPhoto();
                }}
                className="absolute left-4 md:left-6 rounded-full p-3 bg-white/10 hover:bg-white/20 text-white"
                aria-label="Previous photo"
                title="Previous"
              >
                <ChevronLeft className="h-7 w-7" />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  nextPhoto();
                }}
                className="absolute right-4 md:right-6 rounded-full p-3 bg-white/10 hover:bg-white/20 text-white"
                aria-label="Next photo"
                title="Next"
              >
                <ChevronRight className="h-7 w-7" />
              </button>
            </>
          )}
          <div className="mx-4 md:mx-12 max-w-[min(96vw,1200px)]">
            {(() => {
              const p = photos[viewerIndex];
              const src = (p as any)?.fullUrl ?? p.url;
              return (
                <figure className="flex flex-col items-center">
                  <img
                    src={src}
                    alt={p.caption || ""}
                    className="max-h-[80vh] w-auto rounded-xl shadow-2xl object-contain"
                  />
                  {p.caption && (
                    <figcaption className="mt-3 text-sm text-white/90 text-center">
                      {p.caption}
                    </figcaption>
                  )}
                  <div className="mt-1 text-xs text-white/60">
                    {viewerIndex + 1} / {photos.length}
                  </div>
                </figure>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
