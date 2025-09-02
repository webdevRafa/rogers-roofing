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
import { recomputeJob, makeAddress } from "../utils/calc";

// Animation + money display (matching JobDetailPage style)
import { motion, type MotionProps } from "framer-motion";
import CountUp from "react-countup";

// ---------- Animation helpers (same style as JobDetailPage) ----------
const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

const fadeUp = (delay = 0): Partial<MotionProps> => ({
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.35, ease: EASE, delay },
});

const staggerParent: MotionProps["variants"] = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { staggerChildren: 0.08 } },
};

const item: MotionProps["variants"] = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
};

// ---------- Money display (animated) ----------
function CountMoney({
  cents,
  className = "",
}: {
  cents: number;
  className?: string;
}) {
  const dollars = (cents ?? 0) / 100;
  return (
    <span className={className}>
      <CountUp
        key={cents}
        end={dollars}
        decimals={2}
        prefix="$"
        duration={0.6}
      />
    </span>
  );
}

// Support all statuses + "all" filter (same set as your types)
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
        // default stays the same as before
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
    <motion.div
      className="mx-auto w-[min(1100px,92vw)] py-10"
      variants={staggerParent}
      initial="initial"
      animate="animate"
    >
      {/* Header */}
      <motion.header
        className="mb-6 flex items-center justify-between"
        {...fadeUp(0)}
      >
        <h1 className="text-2xl font-bold text-[var(--color-text)]">Jobs</h1>

        <button
          onClick={() => setOpenForm((v) => !v)}
          className="rounded-xl bg-[var(--color-text)]  text-[var(--btn-text)] px-4 py-2 text-sm "
        >
          + New Job
        </button>
      </motion.header>

      {/* Filters */}
      <motion.div
        className="mb-4 flex flex-wrap items-center gap-2"
        {...fadeUp(0.05)}
      >
        {filters.map((f) => (
          <motion.button
            key={f}
            onClick={() => setStatusFilter(f)}
            className={[
              "rounded-full border px-3 py-1 text-xs uppercase tracking-wide transition-colors",
              statusFilter === f
                ? "bg-[var(--color-text)] border-transparent text-white shadow-sm"
                : "bg-transparent border-[var(--color-border)] text-[var(--color-muted)] hover:bg-[var(--color-card-hover)]",
            ].join(" ")}
            whileHover={{ y: -1 }}
            whileTap={{ scale: 0.98 }}
            variants={item}
          >
            {f}
          </motion.button>
        ))}
      </motion.div>

      {/* Create Job form */}
      {openForm && (
        <motion.section
          className="mb-6 rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4"
          {...fadeUp(0.08)}
        >
          <div className="flex w-full gap-5">
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Job address (e.g., 123 Main St, San Antonio, TX)"
              className=" w-full rounded-lg border border-[var(--color-border)] bg-white/70 px-3 py-2 text-sm text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
            />

            <button
              onClick={createJob}
              disabled={loading}
              className="rounded-lg bg-[var(--color-text)] text-[var(--btn-text)] px-3 py-2 text-sm hover:bg-[var(--btn-hover-bg)] disabled:opacity-50"
            >
              {loading ? "Saving..." : "Create"}
            </button>
          </div>
          {error && <div className="mt-3 text-sm text-red-600">{error}</div>}
        </motion.section>
      )}

      {/* Totals */}
      <motion.div
        className="mb-3 text-sm text-[var(--color-text)] font-semibold"
        {...fadeUp(0.1)}
      >
        Total net across {filteredJobs.length} job
        {filteredJobs.length === 1 ? "" : "s"}:{" "}
        <span className="font-bold text-emerald-600">
          <CountMoney cents={totalNet} />
        </span>
      </motion.div>

      {/* List */}
      <motion.div
        className="grid gap-3"
        variants={staggerParent}
        initial="initial"
        animate="animate"
      >
        {filteredJobs.map((job) => (
          <motion.div key={job.id} variants={item}>
            <JobListItem job={job} />
          </motion.div>
        ))}
      </motion.div>
    </motion.div>
  );
}
