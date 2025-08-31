// src/pages/JobsPage.tsx
import { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { db } from "../firebase/firebaseConfig";
import type { Job } from "../types/types";
import { jobConverter } from "../types/types";
import JobListItem from "../components/JobListItem";
import { formatCurrency } from "../utils/money";
import { recomputeJob, makeAddress } from "../utils/calc";
import AuthButton from "../components/AuthButton";

export default function JobsPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [openForm, setOpenForm] = useState(false);
  const [address, setAddress] = useState("");
  const [earnings, setEarnings] = useState<number | "">(""); // dollars
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const q = query(
      collection(db, "jobs").withConverter(jobConverter),
      orderBy("updatedAt", "desc")
    );
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs.map((d) => d.data());
      setJobs(list);
    });
    return () => unsub();
  }, []);

  const totalNet = useMemo(
    () => jobs.reduce((acc, j) => acc + (j.computed?.netProfitCents ?? 0), 0),
    [jobs]
  );

  async function createJob() {
    setLoading(true);
    setError(null);
    try {
      if (!address.trim()) throw new Error("Please enter a job address.");
      const initialEarningsCents = Math.round(Number(earnings || 0) * 100);

      // Create a doc with a generated id
      const newRef = doc(collection(db, "jobs"));
      let job: Job = {
        id: newRef.id,
        status: "active",
        address: makeAddress(address),
        earnings: {
          totalEarningsCents: initialEarningsCents,
          entries: [],
          currency: "USD",
        },
        expenses: {
          totalPayoutsCents: 0,
          totalMaterialsCents: 0,
          payouts: [],
          materials: [],
          currency: "USD",
        },
        summaryNotes: "",
        attachments: [],
        createdAt: serverTimestamp() as any,
        updatedAt: serverTimestamp() as any,
        computed: {
          totalExpensesCents: 0,
          netProfitCents: initialEarningsCents,
        },
      };

      job = recomputeJob(job);

      await setDoc(newRef.withConverter(jobConverter), job);
      setAddress("");
      setEarnings("");
      setOpenForm(false);
    } catch (e: any) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto w-[min(1100px,92vw)] py-10">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-[var(--color-text)]">Jobs</h1>
        <AuthButton />
        <button
          onClick={() => setOpenForm((v) => !v)}
          className="rounded-xl bg-[var(--btn-bg)] text-[var(--btn-text)] px-4 py-2 text-sm hover:bg-[var(--btn-hover-bg)]"
        >
          + New Job
        </button>
      </header>

      {openForm && (
        <div className="mb-6 rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4">
          <div className="grid gap-3 sm:grid-cols-[1fr,160px,120px]">
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Job address (e.g., 123 Main St, San Antonio, TX)"
              className="rounded-lg border border-[var(--color-border)] bg-white/70 px-3 py-2 text-sm text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
            />

            <button
              onClick={createJob}
              disabled={loading}
              className="rounded-lg bg-[var(--btn-bg)] text-[var(--btn-text)] px-3 py-2 text-sm hover:bg-[var(--btn-hover-bg)] disabled:opacity-50"
            >
              {loading ? "Saving..." : "Create"}
            </button>
          </div>
          {error && <div className="mt-3 text-sm text-red-600">{error}</div>}
        </div>
      )}

      <div className="mb-3 text-sm text-[var(--color-muted)]">
        Total net across {jobs.length} job{jobs.length === 1 ? "" : "s"}:{" "}
        <span className="font-semibold text-[var(--color-text)]">
          {formatCurrency(totalNet)}
        </span>
      </div>

      <div className="grid gap-3">
        {jobs.map((job) => (
          <JobListItem key={job.id} job={job} />
        ))}
      </div>
    </div>
  );
}
