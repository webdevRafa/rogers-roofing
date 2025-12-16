import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import {
  doc,
  updateDoc,
  serverTimestamp,
  arrayUnion,
  onSnapshot,
} from "firebase/firestore";

import { db } from "../firebase/firebaseConfig";
import { motion, type MotionProps } from "framer-motion";
import { Plus, X } from "lucide-react";

import { useCurrentEmployee } from "../hooks/useCurrentEmployee";
import type { Job, Note } from "../types/types";

/**
 * CrewJobDetailPage shows a simplified job detail view for crew members and
 * managers. It displays address and task schedules/completion status.
 * Crew can mark tasks as completed and add notes. No financial data is
 * shown. All updates use the server timestamp for audit consistency.
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

  async function markCompleted(
    field: "feltCompletedAt" | "shinglesCompletedAt" | "punchedAt"
  ) {
    if (!job || !id) return;
    try {
      const ref = doc(db, "jobs", id);
      await updateDoc(ref, { [field]: serverTimestamp() });
    } catch (err) {
      console.error(err);
      alert("Failed to mark task complete. See console for details.");
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
        createdAt: serverTimestamp() as any,
      };

      await updateDoc(ref, { notes: arrayUnion(newNote) });
      setNoteText("");
    } catch (err) {
      console.error(err);
      alert("Failed to add note. See console for details.");
    }
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
    </div>
  );
}
