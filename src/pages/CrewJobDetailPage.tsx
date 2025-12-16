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
import { useCurrentEmployee } from "../hooks/useCurrentEmployee";
import type { Job, Note } from "../types/types";

/**
 * CrewJobDetailPage shows a simplified job detail view for crew members and
 * managers. It displays address and task schedules/completion status.
 * Crew can mark tasks as completed and add notes. No financial data is
 * shown. All updates use the server timestamp for audit consistency.
 */
export default function CrewJobDetailPage() {
  const { employee } = useCurrentEmployee();
  const { id } = useParams<{ id: string }>();
  const [job, setJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");
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
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="text-lg font-medium mb-2">Notes</h2>
        {job.notes && job.notes.length > 0 ? (
          <ul className="space-y-2">
            {job.notes.map((note) => (
              <li
                key={note.id}
                className="border border-gray-100 rounded p-2 text-sm"
              >
                <div className="font-semibold text-gray-800">
                  {note.createdBy === employee?.id ? "You" : "Crew"}
                </div>
                <div className="text-gray-600 text-xs">
                  {note.createdAt &&
                    (note.createdAt as any).toDate?.().toLocaleString?.()}
                </div>
                <p className="mt-1 text-gray-700 whitespace-pre-wrap">
                  {note.text}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-gray-500">No notes yet.</p>
        )}
        {/* Add note form */}
        <div className="mt-4">
          <textarea
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            rows={3}
            placeholder="Add a note…"
            className="w-full rounded-md border border-gray-300 p-2 text-sm"
          />
          <button
            onClick={addNote}
            disabled={!noteText.trim()}
            className="mt-2 rounded-md bg-cyan-700 px-3 py-1.5 text-sm text-white disabled:opacity-60"
          >
            Add Note
          </button>
        </div>
      </div>
    </div>
  );
}
