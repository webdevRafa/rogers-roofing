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

// Small util: yyyy-mm-dd from Date
const toYMD = (d: Date) => d.toISOString().slice(0, 10);
// Parse Firestore Timestamp | Date | string to millis (ms)
function toMillis(x: any): number | null {
  if (!x) return null;
  try {
    // Firestore Timestamp has toDate()
    const dt = (x as any)?.toDate ? (x as any).toDate() : new Date(x);
    const n = dt instanceof Date ? dt.getTime() : NaN;
    return Number.isNaN(n) ? null : n;
  } catch {
    return null;
  }
}

// ----------- Date Preset logic (auto-rolling) -----------
type DatePreset = "custom" | "last7" | "thisMonth" | "ytd";

export default function JobsPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [openForm, setOpenForm] = useState(false);
  const [address, setAddress] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  // Date range filter state (YYYY-MM-DD)
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [datePreset, setDatePreset] = useState<DatePreset>("custom");

  function recomputeDates(p: DatePreset, now = new Date()) {
    if (p === "last7") {
      const end = now;
      const start = new Date(end);
      start.setDate(end.getDate() - 6); // inclusive 7-day window
      setStartDate(toYMD(start));
      setEndDate(toYMD(end));
    } else if (p === "thisMonth") {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      setStartDate(toYMD(start));
      setEndDate(toYMD(end));
    } else if (p === "ytd") {
      const start = new Date(now.getFullYear(), 0, 1);
      setStartDate(toYMD(start));
      setEndDate(toYMD(now));
    }
  }

  function applyPreset(p: DatePreset) {
    setDatePreset(p);
    if (p !== "custom") recomputeDates(p);
  }

  function msUntilNextMidnight() {
    const now = new Date();
    const next = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + 1,
      0,
      0,
      0,
      50 // tiny buffer
    );
    return next.getTime() - now.getTime();
  }

  // Auto-roll the preset range at midnight.
  useEffect(() => {
    if (datePreset === "custom") return;
    // compute now, then again every midnight
    recomputeDates(datePreset);
    let timer = setTimeout(function tick() {
      recomputeDates(datePreset);
      timer = setTimeout(tick, msUntilNextMidnight());
    }, msUntilNextMidnight());
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datePreset]);

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

  // Status + Date filtering (client-side so we don't need new Firestore indexes)
  const filteredJobs = useMemo(() => {
    const hasStart = Boolean(startDate);
    const hasEnd = Boolean(endDate);
    const startMs = hasStart
      ? new Date(startDate + "T00:00:00").getTime()
      : null;
    const endMs = hasEnd ? new Date(endDate + "T23:59:59.999").getTime() : null;

    return jobs.filter((j) => {
      // status filter
      if (statusFilter !== "all" && j.status !== statusFilter) return false;

      // date filter against updatedAt (fallback to createdAt if missing)
      const reference = j.updatedAt ?? j.createdAt ?? null;
      const ts = toMillis(reference);
      if (ts == null) return false;

      if (startMs != null && ts < startMs) return false;
      if (endMs != null && ts > endMs) return false;
      return true;
    });
  }, [jobs, statusFilter, startDate, endDate]);

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
          className="rounded-xl bg-[var(--color-text)] text-[var(--btn-text)] px-4 py-2 text-sm"
        >
          + New Job
        </button>
      </motion.header>

      {/* Status Filters */}
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
          className="mb-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4"
          {...fadeUp(0.08)}
        >
          <div className="flex w-full gap-3">
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Job address (e.g., 123 Main St, San Antonio, TX)"
              className="w-full rounded-lg border border-[var(--color-border)] bg-white/70 px-3 py-2 text-sm text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
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

      {/* Date range filters (always visible) */}
      <motion.section
        className="mb-6 rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4"
        {...fadeUp(0.09)}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label className="mb-1 block text-xs text-[var(--color-muted)]">
              Start date
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => {
                setDatePreset("custom");
                setStartDate(e.target.value);
              }}
              className="w-full rounded-lg border border-[var(--color-border)] bg-white/80 px-3 py-2 text-sm text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
            />
          </div>
          <div className="flex-1">
            <label className="mb-1 block text-xs text-[var(--color-muted)]">
              End date
            </label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => {
                setDatePreset("custom");
                setEndDate(e.target.value);
              }}
              className="w-full rounded-lg border border-[var(--color-border)] bg-white/80 px-3 py-2 text-sm text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
            />
          </div>

          <div className="flex flex-wrap gap-2 sm:ml-2">
            <button
              onClick={() => applyPreset("last7")}
              className="rounded-lg border border-[var(--color-border)] bg-white px-3 py-2 text-xs text-[var(--color-text)] hover:bg-[var(--color-card-hover)]"
            >
              Last 7 days
            </button>
            <button
              onClick={() => applyPreset("thisMonth")}
              className="rounded-lg border border-[var(--color-border)] bg-white px-3 py-2 text-xs text-[var(--color-text)] hover:bg-[var(--color-card-hover)]"
            >
              This month
            </button>
            <button
              onClick={() => applyPreset("ytd")}
              className="rounded-lg border border-[var(--color-border)] bg-white px-3 py-2 text-xs text-[var(--color-text)] hover:bg-[var(--color-card-hover)]"
            >
              Year to date
            </button>
            <button
              onClick={() => {
                setDatePreset("custom");
                setStartDate("");
                setEndDate("");
              }}
              className="rounded-lg bg-[var(--color-text)] px-3 py-2 text-xs text-white"
            >
              Clear
            </button>
          </div>
        </div>
        <p className="mt-2 text-xs text-[var(--color-muted)]">
          Filters use each job's <strong>last updated</strong> date (falls back
          to created date).
        </p>
      </motion.section>

      {/* Totals */}
      <motion.div
        className="mb-3 text-sm font-semibold text-[var(--color-text)]"
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
        {filteredJobs.length === 0 && (
          <div className="text-sm text-[var(--color-muted)]">
            No jobs match the current filters.
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}
