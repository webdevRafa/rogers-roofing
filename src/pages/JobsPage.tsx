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
import type { FieldValue } from "firebase/firestore";
import { db } from "../firebase/firebaseConfig";
import type { Job, JobStatus } from "../types/types";
import { jobConverter } from "../types/types";
import { recomputeJob, makeAddress } from "../utils/calc";
import { Link, useNavigate } from "react-router-dom"; // ✅ changed: add useNavigate

import { motion, type MotionProps } from "framer-motion";
import CountUp from "react-countup";
import { Search } from "lucide-react";
import logo from "../assets/rogers-roofing.webp";

// ---------- Animation helpers ----------
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

// ---------- Status pill ----------
function statusClasses(status: JobStatus) {
  switch (status) {
    case "active":
      return "bg-[var(--color-primary)]/15 text-[var(--color-primary)]";
    case "pending":
      return "bg-yellow-100 text-yellow-800";
    case "invoiced":
      return "bg-blue-100 text-blue-700";
    case "paid":
      return "bg-emerald-100 text-emerald-700";
    case "closed":
      return "bg-gray-200 text-gray-700";
    case "archived":
      return "bg-slate-200 text-slate-700";
    case "draft":
    default:
      return "bg-neutral-100 text-neutral-700";
  }
}

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

// Small util: yyyy-mm-dd from Date
const toYMD = (d: Date) => d.toISOString().slice(0, 10);

// ---- Type guards & date utils ----
function isFsTimestamp(val: unknown): val is { toDate: () => Date } {
  return typeof (val as { toDate?: () => Date })?.toDate === "function";
}
function toMillis(x: unknown): number | null {
  if (x == null) return null;
  let dt: Date | null = null;
  if (isFsTimestamp(x)) dt = x.toDate();
  else if (x instanceof Date) dt = x;
  else if (typeof x === "string" || typeof x === "number") {
    const candidate = new Date(x);
    if (!Number.isNaN(candidate.getTime())) dt = candidate;
  }
  return dt ? dt.getTime() : null;
}
function fmtDateTime(x: unknown): string {
  const ms = toMillis(x);
  return ms == null ? "—" : new Date(ms).toLocaleString();
}

// ---- Address normalizer (string or object, supports `fullLine`) ----
function pickString(obj: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim().length > 0) return v;
  }
  return "";
}
function addr(a: Job["address"] | null | undefined) {
  if (typeof a === "string")
    return { display: a, line1: a, city: "", state: "", zip: "" };
  const obj: Record<string, unknown> =
    (a as unknown as Record<string, unknown>) ?? {};
  const line1 = pickString(obj, [
    "fullLine",
    "line1",
    "street",
    "address1",
    "address",
    "full",
    "formatted",
    "text",
    "label",
    "line",
    "street1",
  ]);
  const city = pickString(obj, ["city", "town"]);
  const state = pickString(obj, ["state", "region", "province"]);
  const zip = pickString(obj, ["zip", "postalCode", "postcode", "zipCode"]);
  const display =
    pickString(obj, ["fullLine", "full", "formatted", "label", "text"]) ||
    line1;
  return { display, line1, city, state, zip };
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

  // ✅ new: navigate to the created job
  const navigate = useNavigate();

  // Search
  const [showSearch, setShowSearch] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

  // Date range filter state (YYYY-MM-DD)
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [datePreset, setDatePreset] = useState<DatePreset>("custom");

  function recomputeDates(p: DatePreset, now = new Date()) {
    if (p === "last7") {
      const end = now;
      const start = new Date(end);
      start.setDate(end.getDate() - 6);
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
      50
    );
    return next.getTime() - now.getTime();
  }

  // Auto-roll the preset range at midnight.
  useEffect(() => {
    if (datePreset === "custom") return;
    recomputeDates(datePreset);
    let timer = setTimeout(function tick() {
      recomputeDates(datePreset);
      timer = setTimeout(tick, msUntilNextMidnight());
    }, msUntilNextMidnight());
    return () => clearTimeout(timer);
  }, [datePreset]);

  // Live jobs
  useEffect(() => {
    const q = query(
      collection(db, "jobs").withConverter(jobConverter),
      orderBy("updatedAt", "desc")
    );
    const unsub = onSnapshot(q, (snap) =>
      setJobs(snap.docs.map((d) => d.data()))
    );
    return () => unsub();
  }, []);

  // Status + Date + Address filtering
  const filteredJobs = useMemo(() => {
    const hasStart = Boolean(startDate);
    const hasEnd = Boolean(endDate);
    const startMs = hasStart
      ? new Date(startDate + "T00:00:00").getTime()
      : null;
    const endMs = hasEnd ? new Date(endDate + "T23:59:59.999").getTime() : null;
    const term = searchTerm.trim().toLowerCase();

    return jobs.filter((j) => {
      if (statusFilter !== "all" && j.status !== statusFilter) return false;

      const reference = j.updatedAt ?? j.createdAt ?? null;
      const ts = toMillis(reference);
      if (ts == null) return false;

      if (startMs != null && ts < startMs) return false;
      if (endMs != null && ts > endMs) return false;

      if (term.length > 0) {
        const a = addr(j.address);
        const haystack = [a.display, a.line1, a.city, a.state, a.zip]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(term)) return false;
      }

      return true;
    });
  }, [jobs, statusFilter, startDate, endDate, searchTerm]);

  const totalNet = useMemo(
    () =>
      filteredJobs.reduce(
        (acc, j) => acc + (j.computed?.netProfitCents ?? 0),
        0
      ),
    [filteredJobs]
  );

  // Create job → redirect to detail
  async function createJob() {
    setLoading(true);
    setError(null);
    try {
      if (!address.trim()) throw new Error("Please enter a job address.");
      const newRef = doc(collection(db, "jobs"));
      let job: Job = {
        id: newRef.id,
        status: "pending",
        address: makeAddress(address),
        earnings: { totalEarningsCents: 0, entries: [], currency: "USD" },
        expenses: {
          totalPayoutsCents: 0,
          totalMaterialsCents: 0,
          payouts: [],
          materials: [],
          currency: "USD",
        },
        summaryNotes: "",
        attachments: [],
        createdAt: serverTimestamp() as FieldValue,
        updatedAt: serverTimestamp() as FieldValue,
        computed: { totalExpensesCents: 0, netProfitCents: 0 },
      };
      job = recomputeJob(job);
      await setDoc(newRef.withConverter(jobConverter), job);

      // ✅ NEW: go straight to the job's dynamic page
      navigate(`/job/${newRef.id}`);

      // (Optional clean-up if user navigates back)
      setAddress("");
      setOpenForm(false);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  const filters: StatusFilter[] = ["all", ...STATUS_OPTIONS];

  return (
    <>
      <div className="">
        <nav className="sticky top-0 z-10   backdrop-blur">
          <div className="mx-auto max-w-[1200px] flex items-center justify-between py-3">
            <div className="text-3xl font-griffon uppercase text-[var(--color-logo)] flex justify-between w-full items-center">
              Roger's Roofing & Contracting LLC
              <img className="max-w-[100px] rounded-2xl" src={logo} alt="" />
            </div>
          </div>
        </nav>
      </div>
      <motion.div
        className="mx-auto w-[min(1200px,94vw)] py-6 sm:py-10"
        variants={staggerParent}
        initial="initial"
        animate="animate"
      >
        {/* Header */}
        <motion.header
          className="mb-4 sm:mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
          {...fadeUp(0)}
        >
          <h1 className="text-xl sm:text-2xl font-bold text-[var(--color-text)]">
            Jobs
          </h1>

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
            {/* Search bar (collapsible on mobile) */}
            <div className="relative">
              <button
                onClick={() => setShowSearch((v) => !v)}
                className="inline-flex items-center justify-center rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-2 text-sm text-[var(--color-text)] hover:bg-[var(--color-card-hover)] w-full sm:w-auto"
                title="Search addresses"
                aria-label="Search addresses"
              >
                <Search size={16} className="mr-2" />
                <span className="sm:hidden">Search</span>
              </button>

              {showSearch && (
                <div className="mt-2 sm:absolute sm:right-0 sm:mt-2 w-full sm:w-80 rounded-xl border border-[var(--color-border)] bg-white p-2 shadow-lg">
                  <input
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Search by address, city, state, or ZIP…"
                    autoFocus
                    className="w-full rounded-lg border border-[var(--color-border)] bg-white/80 px-3 py-2 text-sm text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                  />
                  {searchTerm && (
                    <div className="mt-1 text-xs text-[var(--color-muted)]">
                      Filtering by:{" "}
                      <span className="font-medium">{searchTerm}</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            <button
              onClick={() => setOpenForm((v) => !v)}
              className="rounded-xl bg-cyan-800 hover:bg-cyan-700 transition duration-300 ease-in-out text-[var(--btn-text)] px-4 py-2 text-sm"
            >
              + New Job
            </button>
          </div>
        </motion.header>

        {/* Status Filters (scrollable on mobile) */}
        <motion.div
          className="mb-4 flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          {...fadeUp(0.05)}
        >
          {filters.map((f) => (
            <motion.button
              key={f}
              onClick={() => setStatusFilter(f)}
              className={[
                "whitespace-nowrap rounded-full border px-3 py-1 text-xs uppercase tracking-wide transition-colors",
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
            <div className="flex w-full flex-col gap-2 sm:flex-row sm:gap-3">
              <input
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Job address (e.g., 123 Main St, San Antonio, TX)"
                className="w-full rounded-lg border border-[var(--color-border)] bg-white/70 px-3 py-2 text-sm text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
              />
              <div className="flex items-center gap-2">
                <button
                  onClick={createJob}
                  disabled={loading}
                  className="w-full sm:w-auto rounded-lg bg-cyan-800 hover:bg-cyan-700 transition duration-300 ease-in-out text-[var(--btn-text)] px-3 py-2 text-sm  disabled:opacity-50"
                >
                  {loading ? "Saving..." : "Create"}
                </button>
              </div>
            </div>
            {error && <div className="mt-3 text-sm text-red-600">{error}</div>}
          </motion.section>
        )}

        {/* Date range filters */}
        <motion.section
          className="mb-6 rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4"
          {...fadeUp(0.09)}
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto_auto_auto_auto] sm:items-end">
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
            Filters use each job&apos;s <strong>last updated</strong> date
            (falls back to created date).
          </p>
        </motion.section>

        {/* Totals */}
        <motion.div
          className="mb-3 text-xl font-semibold text-[var(--color-text)]"
          {...fadeUp(0.1)}
        >
          Total net across {filteredJobs.length} job
          {filteredJobs.length === 1 ? "" : "s"}:{" "}
          <span className="font-bold text-emerald-600">
            <CountMoney cents={totalNet} />
          </span>
        </motion.div>

        {/* ====== MOBILE CARDS (default) ====== */}
        <div className="grid gap-3 sm:hidden">
          {filteredJobs.map((job) => {
            const a = addr(job.address);
            return (
              <div
                key={job.id}
                className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-medium text-[var(--color-text)]">
                      {a.display || "—"}
                    </div>
                    {(a.city || a.state || a.zip) && (
                      <div className="text-xs text-[var(--color-muted)]">
                        {[a.city, a.state, a.zip].filter(Boolean).join(", ")}
                      </div>
                    )}
                  </div>
                  <span
                    className={`rounded-md px-2 py-1 text-[10px] font-semibold uppercase ${statusClasses(
                      job.status
                    )}`}
                  >
                    {job.status}
                  </span>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                  <div className="rounded-lg bg-white/60 p-2">
                    <div className="text-[var(--color-muted)] text-xs">
                      Earnings
                    </div>
                    <div className="font-medium">
                      <CountMoney
                        cents={job.earnings?.totalEarningsCents ?? 0}
                      />
                    </div>
                  </div>
                  <div className="rounded-lg bg-white/60 p-2 text-right">
                    <div className="text-[var(--color-muted)] text-xs">
                      Expenses
                    </div>
                    <div className="font-medium">
                      <CountMoney
                        cents={job.computed?.totalExpensesCents ?? 0}
                      />
                    </div>
                  </div>
                  <div className="rounded-lg bg-white/60 p-2 col-span-2">
                    <div className="text-[var(--color-muted)] text-xs">Net</div>
                    <div
                      className={
                        (job.computed?.netProfitCents ?? 0) >= 0
                          ? "text-emerald-600 font-semibold"
                          : "text-red-600 font-semibold"
                      }
                    >
                      <CountMoney cents={job.computed?.netProfitCents ?? 0} />
                    </div>
                  </div>
                </div>

                <div className="mt-3 text-xs text-[var(--color-muted)]">
                  <div>Updated {fmtDateTime(job.updatedAt)}</div>
                  <div>Created {fmtDateTime(job.createdAt)}</div>
                </div>

                <div className="mt-3 text-right">
                  <Link
                    to={`/job/${job.id}`}
                    className="inline-block rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-text)] hover:bg-[var(--color-card-hover)]"
                  >
                    View
                  </Link>
                </div>
              </div>
            );
          })}
          {filteredJobs.length === 0 && (
            <div className="text-center text-[var(--color-muted)]">
              No jobs match the current filters.
            </div>
          )}
        </div>

        {/* ====== DESKTOP TABLE (sm and up) ====== */}
        <motion.div
          className="hidden sm:block rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] overflow-hidden"
          variants={staggerParent}
          initial="initial"
          animate="animate"
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-white/60 text-[var(--color-muted)]">
                <tr>
                  <th className="text-left px-4 py-3">Address</th>
                  <th className="text-left px-4 py-3">Status</th>
                  <th className="text-right px-4 py-3">Total Job Pay</th>
                  <th className="text-right px-4 py-3">Expenses</th>
                  <th className="text-right px-4 py-3">Net</th>
                  <th className="text-left px-4 py-3">Last Updated</th>
                  <th className="text-right px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredJobs.map((job, idx) => {
                  const a = addr(job.address);
                  return (
                    <motion.tr
                      key={job.id}
                      variants={item}
                      className={idx % 2 === 0 ? "bg-white/40" : "bg-white/20"}
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium text-[var(--color-text)]">
                          <Link
                            to={`/job/${job.id}`}
                            className="hover:underline"
                          >
                            {a.display || "—"}
                          </Link>
                        </div>
                        {(a.city || a.state || a.zip) && (
                          <div className="text-xs text-[var(--color-muted)]">
                            {[a.city, a.state, a.zip]
                              .filter(Boolean)
                              .join(", ")}
                          </div>
                        )}
                      </td>

                      <td className="px-4 py-3">
                        <span
                          className={`inline-block rounded-md px-2 py-1 text-[10px] font-semibold uppercase ${statusClasses(
                            job.status
                          )}`}
                        >
                          {job.status}
                        </span>
                      </td>

                      <td className="px-4 py-3 text-right">
                        <CountMoney
                          cents={job.earnings?.totalEarningsCents ?? 0}
                        />
                      </td>

                      <td className="px-4 py-3 text-right">
                        <CountMoney
                          cents={job.computed?.totalExpensesCents ?? 0}
                        />
                      </td>

                      <td className="px-4 py-3 text-right">
                        <span
                          className={
                            (job.computed?.netProfitCents ?? 0) >= 0
                              ? "text-emerald-600 font-semibold"
                              : "text-red-600 font-semibold"
                          }
                        >
                          <CountMoney
                            cents={job.computed?.netProfitCents ?? 0}
                          />
                        </span>
                      </td>

                      <td className="px-4 py-3">
                        <div className="text-[var(--color-text)]">
                          {fmtDateTime(job.updatedAt)}
                        </div>
                        <div className="text-xs text-[var(--color-muted)]">
                          Created {fmtDateTime(job.createdAt)}
                        </div>
                      </td>

                      <td className="px-4 py-3 text-right">
                        <Link
                          to={`/job/${job.id}`}
                          className="inline-block rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-text)] hover:bg-[var(--color-card-hover)]"
                        >
                          View
                        </Link>
                      </td>
                    </motion.tr>
                  );
                })}
                {filteredJobs.length === 0 && (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-4 py-6 text-center text-[var(--color-muted)]"
                    >
                      No jobs match the current filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </motion.div>
      </motion.div>
    </>
  );
}
