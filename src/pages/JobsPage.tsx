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
import type { Job, JobStatus } from "../types/types";
import { jobConverter } from "../types/types";
import JobListItem from "../components/JobListItem";
import { formatCurrency } from "../utils/money";
import { recomputeJob, makeAddress } from "../utils/calc";

// Support all statuses + "all" filter
type StatusFilter = "all" | JobStatus;
const STATUS_OPTIONS: JobStatus[] = [
  "draft",
  "pending",
  "active",
  "invoiced",
  "paid",
  "closed",
  "archived",
];

export default function JobsPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [openForm, setOpenForm] = useState(false);
  const [address, setAddress] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

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

  const filteredJobs = useMemo(() => {
    if (statusFilter === "all") return jobs;
    return jobs.filter((j) => j.status === statusFilter);
  }, [jobs, statusFilter]);

  const totalNet = useMemo(
    () =>
      filteredJobs.reduce(
        (acc, j) => acc + (j.computed?.netProfitCents ?? 0),
        0
      ),
    [filteredJobs]
  );

  async function createJob() {
    setLoading(true);
    setError(null);
    try {
      if (!address.trim()) throw new Error("Please enter a job address.");

      // Create a doc with a generated id
      const newRef = doc(collection(db, "jobs"));
      let job: Job = {
        id: newRef.id,
        // Default to 'pending' until user explicitly starts it
        status: "pending",
        address: makeAddress(address),
        earnings: {
          totalEarningsCents: 0,
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
          netProfitCents: 0,
        },
      };

      job = recomputeJob(job);

      await setDoc(newRef.withConverter(jobConverter), job);
      setAddress("");
      setOpenForm(false);
    } catch (e: any) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  const filters: StatusFilter[] = ["all", ...STATUS_OPTIONS];

  return (
    <div className="mx-auto w-[min(1100px,92vw)] py-10">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-[var(--color-text)]">Jobs</h1>

        <button
          onClick={() => setOpenForm((v) => !v)}
          className="rounded-xl bg-[var(--btn-bg)] text-[var(--btn-text)] px-4 py-2 text-sm hover:bg-[var(--btn-hover-bg)]"
        >
          + New Job
        </button>
      </header>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {filters.map((f) => (
          <button
            key={f}
            onClick={() => setStatusFilter(f)}
            className={[
              "rounded-full border px-3 py-1 text-xs uppercase tracking-wide transition-colors",
              statusFilter === f
                ? "bg-[var(--color-primary)] border-transparent text-white shadow-sm"
                : "bg-transparent border-[var(--color-border)] text-[var(--color-muted)] hover:bg-[var(--color-card-hover)]",
            ].join(" ")}
          >
            {f}
          </button>
        ))}
      </div>

      {openForm && (
        <div className="mb-6 rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4">
          <div className="grid gap-3 sm:grid-cols-[1fr,120px]">
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

      <div className="mb-3 text-sm text-[var(--color-text)] font-semibold">
        Total net across {filteredJobs.length} job
        {filteredJobs.length === 1 ? "" : "s"}:{" "}
        <span className="font-bold text-emerald-600">
          {formatCurrency(totalNet)}
        </span>
      </div>

      <div className="grid gap-3">
        {filteredJobs.map((job) => (
          <JobListItem key={job.id} job={job} />
        ))}
      </div>
    </div>
  );
}
