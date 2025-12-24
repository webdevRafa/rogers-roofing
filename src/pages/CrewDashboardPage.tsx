import { useEffect, useMemo, useState } from "react";
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { useNavigate } from "react-router-dom";
import {
  AnimatePresence,
  motion,
  type MotionProps,
  type Variants,
} from "framer-motion";
import { ChevronDown, Search } from "lucide-react";

import { db } from "../firebase/firebaseConfig";
import { useCurrentEmployee } from "../hooks/useCurrentEmployee";
import type { Job, PayoutStubDoc } from "../types/types";

/**
 * CrewDashboardPage
 * - Crew: sees jobs assigned to them + their payout history.
 * - Manager (crew portal): sees all jobs + their own payout history.
 *
 * UI matches the "admin" dashboard styling patterns:
 * - soft glass cards (bg-white/60 → bg-white)
 * - collapsible sections
 * - quick summary cards
 * - search + filters
 * - clean empty states
 */

// ---------- small utils ----------

function money(cents?: number | null): string {
  const v = typeof cents === "number" ? cents : 0;
  return (v / 100).toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
  });
}

type FsTimestampLike = { toDate: () => Date };
function isFsTimestamp(x: unknown): x is FsTimestampLike {
  return typeof (x as FsTimestampLike)?.toDate === "function";
}
function toMillis(v: unknown): number | null {
  if (!v) return null;
  if (typeof v === "number") return v;
  if (v instanceof Date) return v.getTime();
  if (isFsTimestamp(v)) return v.toDate().getTime();
  if (typeof v === "string") {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d.getTime();
  }
  return null;
}
function fmtDateTime(v: unknown): string {
  const ms = toMillis(v);
  if (ms == null) return "—";
  const d = new Date(ms);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

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

type CrewJobTab = "all" | "active" | "completed";

function statusClasses(status: Job["status"]) {
  switch (status) {
    case "active":
      return "bg-[var(--color-primary)]/15 text-[var(--color-primary)]";
    case "pending":
      return "bg-yellow-100 text-yellow-800";
    case "invoiced":
      return "bg-blue-100 text-blue-700";
    case "paid":
    case "completed":
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

// ---------- motion helpers (match admin dashboard sections) ----------
const EASE = [0.16, 1, 0.3, 1] as const;

const fadeUp = (delay = 0): MotionProps => ({
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.35, ease: EASE, delay },
});

const staggerParent: Variants = {
  initial: { opacity: 0 },
  animate: {
    opacity: 1,
    transition: { staggerChildren: 0.05, delayChildren: 0.05 },
  },
};

const item: Variants = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
};

function Chip({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-[var(--color-border)] bg-white/70 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">
      <span className="text-[var(--color-text)]/70">{label}</span>
      <span className="text-[var(--color-text)]">{value}</span>
    </span>
  );
}

function StatCard({
  label,
  value,
  className = "",
}: {
  label: string;
  value: number | string;
  className?: string;
}) {
  return (
    <div
      className={
        "rounded-xl bg-white/60 p-4 shadow-md border border-[var(--color-border)]/40 " +
        className
      }
    >
      <div className="text-xl font-semibold text-[var(--color-text)]">
        {value}
      </div>
      <div className="text-xs uppercase tracking-wide text-[var(--color-muted)]">
        {label}
      </div>
    </div>
  );
}

export default function CrewDashboardPage() {
  const { employee, loading } = useCurrentEmployee();
  const navigate = useNavigate();

  const [jobs, setJobs] = useState<Job[]>([]);
  const [jobsLoading, setJobsLoading] = useState(true);
  const [jobsError, setJobsError] = useState<string | null>(null);

  const [stubs, setStubs] = useState<PayoutStubDoc[]>([]);
  const [stubsLoading, setStubsLoading] = useState(true);
  const [stubsError, setStubsError] = useState<string | null>(null);

  // UI state
  const [jobsOpen, setJobsOpen] = useState(true);
  const [payoutsOpen, setPayoutsOpen] = useState(true);

  const [jobTab, setJobTab] = useState<CrewJobTab>("active");
  const [jobSearch, setJobSearch] = useState("");
  const [stubSearch, setStubSearch] = useState("");

  // Pagination
  const [jobsPage, setJobsPage] = useState(1);
  const JOBS_PER_PAGE = 12;
  const [stubsPage, setStubsPage] = useState(1);
  const STUBS_PER_PAGE = 10;

  const accessRole = (employee as any)?.accessRole as
    | "manager"
    | "crew"
    | "readOnly"
    | undefined;
  const employeeId = (employee as any)?.id as string | undefined;

  // ---------- Jobs subscription ----------
  useEffect(() => {
    if (loading) return;
    if (!employeeId) {
      setJobs([]);
      setJobsLoading(false);
      return;
    }

    setJobsLoading(true);
    setJobsError(null);

    // Managers: all jobs; Crew/readOnly: jobs assigned to them
    const jobsQ =
      accessRole === "manager"
        ? query(collection(db, "jobs"), orderBy("createdAt", "desc"))
        : query(
            collection(db, "jobs"),
            where("assignedEmployeeIds", "array-contains", employeeId),
            orderBy("createdAt", "desc")
          );

    const unsub = onSnapshot(
      jobsQ,
      (snap) => {
        const list = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<Job, "id">),
        }));
        setJobs(list);
        setJobsLoading(false);
      },
      (err) => {
        console.error(err);
        setJobsError(err.message || "Failed to load jobs.");
        setJobs([]);
        setJobsLoading(false);
      }
    );

    return () => unsub();
  }, [accessRole, employeeId, loading]);

  // ---------- Payout stubs subscription ----------
  useEffect(() => {
    if (loading) return;
    if (!employeeId) {
      setStubs([]);
      setStubsLoading(false);
      return;
    }

    setStubsLoading(true);
    setStubsError(null);

    const stubsQ = query(
      collection(db, "payoutStubs"),
      where("employeeId", "==", employeeId),
      orderBy("createdAt", "desc")
    );

    const unsub = onSnapshot(
      stubsQ,
      (snap) => {
        const list: PayoutStubDoc[] = snap.docs.map((d) => {
          const data = d.data() as PayoutStubDoc;
          return { ...data, id: d.id };
        });
        setStubs(list);
        setStubsLoading(false);
      },
      (err) => {
        console.error(err);
        setStubsError(err.message || "Failed to load payout history.");
        setStubs([]);
        setStubsLoading(false);
      }
    );

    return () => unsub();
  }, [employeeId, loading]);

  // ---------- derived data ----------

  const sortedJobs = useMemo(() => {
    return [...jobs].sort((a, b) => {
      const aMs = toMillis(a.updatedAt ?? a.createdAt) ?? 0;
      const bMs = toMillis(b.updatedAt ?? b.createdAt) ?? 0;
      return bMs - aMs;
    });
  }, [jobs]);

  const activeStatuses = new Set(["active", "pending", "invoiced", "draft"]);
  const completedStatuses = new Set(["paid", "completed", "closed"]);

  const filteredJobs = useMemo(() => {
    const term = jobSearch.trim().toLowerCase();

    return sortedJobs.filter((j) => {
      const isActive = activeStatuses.has(j.status);
      const isCompleted = completedStatuses.has(j.status);

      const tabOk =
        jobTab === "all" ? true : jobTab === "active" ? isActive : isCompleted;

      if (!tabOk) return false;

      if (!term) return true;
      const a = addr(j.address);
      const hay = [a.display, j.status, String(j.id)].join(" ").toLowerCase();
      return hay.includes(term);
    });
  }, [jobSearch, jobTab, sortedJobs]);

  const jobsTotalPages = Math.max(
    1,
    Math.ceil(filteredJobs.length / JOBS_PER_PAGE)
  );
  const pagedJobs = useMemo(() => {
    const start = (jobsPage - 1) * JOBS_PER_PAGE;
    return filteredJobs.slice(start, start + JOBS_PER_PAGE);
  }, [filteredJobs, jobsPage]);

  const filteredStubs = useMemo(() => {
    const term = stubSearch.trim().toLowerCase();
    if (!term) return stubs;
    return stubs.filter((s) => {
      const hay = [s.number, s.status, money(s.totalCents)]
        .join(" ")
        .toLowerCase();
      return hay.includes(term);
    });
  }, [stubSearch, stubs]);

  const stubsTotalPages = Math.max(
    1,
    Math.ceil(filteredStubs.length / STUBS_PER_PAGE)
  );
  const pagedStubs = useMemo(() => {
    const start = (stubsPage - 1) * STUBS_PER_PAGE;
    return filteredStubs.slice(start, start + STUBS_PER_PAGE);
  }, [filteredStubs, stubsPage]);

  const counts = useMemo(() => {
    const active = sortedJobs.filter((j) =>
      activeStatuses.has(j.status)
    ).length;
    const completed = sortedJobs.filter((j) =>
      completedStatuses.has(j.status)
    ).length;
    const pendingPayoutStubs = stubs.filter((s) => s.status === "draft").length;
    const paidPayoutStubs = stubs.filter((s) => s.status === "paid").length;
    return { active, completed, pendingPayoutStubs, paidPayoutStubs };
  }, [sortedJobs, stubs]);

  // Reset pagination when filters/search change
  useEffect(() => setJobsPage(1), [jobTab, jobSearch]);
  useEffect(() => setStubsPage(1), [stubSearch]);

  // ---------- loading / error states ----------
  if (loading) {
    return (
      <div className="py-10 text-center text-[var(--color-muted)]">
        Loading…
      </div>
    );
  }

  return (
    <div className="pb-20">
      {/* Header */}
      <motion.header
        className="mb-6 select-none flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between rounded-2xl bg-white/60 hover:bg-white transition duration-300 ease-in-out p-6 shadow-md hover:shadow-lg"
        {...fadeUp(0)}
      >
        <div>
          <div className="text-xs uppercase tracking-wide text-[var(--color-muted)]">
            Crew portal
          </div>
          <h1 className="mt-1 text-2xl sm:text-3xl font-semibold text-[var(--color-text)]">
            My Dashboard
          </h1>
          <p className="mt-1 text-sm text-[var(--color-muted)]">
            Your assigned jobs and payout history in one place.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {accessRole && (
            <span className="inline-flex items-center rounded-full bg-[var(--color-card)] px-3 py-1 text-[11px] font-semibold text-[var(--color-text)]/80 border border-[var(--color-border)]">
              Role: {accessRole}
            </span>
          )}
          {employeeId && (
            <span className="inline-flex items-center rounded-full bg-[var(--color-card)] px-3 py-1 text-[11px] font-semibold text-[var(--color-text)]/80 border border-[var(--color-border)]">
              ID: {employeeId.slice(0, 6)}…
            </span>
          )}
        </div>
      </motion.header>

      {/* Summary cards */}
      <motion.section
        className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4"
        {...fadeUp(0.05)}
      >
        <StatCard
          label="Active / upcoming"
          value={counts.active}
          className="bg-sky-50"
        />
        <StatCard
          label="Completed"
          value={counts.completed}
          className="bg-emerald-50"
        />
        <StatCard label="Draft stubs" value={counts.pendingPayoutStubs} />
        <StatCard label="Paid stubs" value={counts.paidPayoutStubs} />
      </motion.section>

      {/* Jobs */}
      <motion.section
        className="rounded-2xl bg-white/60 hover:bg-white transition duration-300 ease-in-out p-4 sm:p-6 shadow-md hover:shadow-lg"
        {...fadeUp(0.08)}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div>
              <h2 className="text-xl sm:text-2xl font-semibold text-[var(--color-text)]">
                My Jobs
              </h2>
              <p className="mt-1 text-xs text-[var(--color-muted)]">
                {accessRole === "manager"
                  ? "Showing all jobs (manager view)."
                  : "Showing jobs assigned to you."}
              </p>
            </div>

            <button
              type="button"
              onClick={() => setJobsOpen((v) => !v)}
              className="inline-flex items-center text-xs border border-[var(--color-border)] bg-[var(--color-brown-hover)] hover:bg-[var(--color-brown)] cursor-pointer transition duration-300 ease-in-out px-3 py-1 text-white"
            >
              <ChevronDown
                className={`h-4 w-4 transition-transform ${
                  jobsOpen ? "rotate-0" : "-rotate-90"
                }`}
              />
              <span className="ml-2 hidden sm:inline">
                {jobsOpen ? "Collapse" : "Expand"}
              </span>
            </button>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            {/* Tabs */}
            <div className="inline-flex rounded-full border border-[var(--color-border)] bg-white/80 p-1 text-xs">
              {(
                [
                  ["active", "Active"],
                  ["completed", "Completed"],
                  ["all", "All"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setJobTab(key)}
                  className={
                    "px-3 py-1 rounded-full transition " +
                    (jobTab === key
                      ? "bg-cyan-800 text-white"
                      : "text-[var(--color-text)] hover:bg-[var(--color-card-hover)]")
                  }
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Search */}
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--color-muted)]" />
              <input
                value={jobSearch}
                onChange={(e) => setJobSearch(e.target.value)}
                placeholder="Search jobs…"
                className="w-full sm:w-72 rounded-lg border border-[var(--color-border)] bg-white/80 pl-9 pr-3 py-2 text-sm text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
              />
            </div>
          </div>
        </div>

        <AnimatePresence initial={false}>
          {jobsOpen && (
            <motion.div
              className="mt-5"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.25, ease: EASE }}
            >
              {jobsLoading && (
                <div className="text-sm text-[var(--color-muted)]">
                  Loading jobs…
                </div>
              )}
              {jobsError && (
                <div className="text-sm text-red-600">{jobsError}</div>
              )}

              {!jobsLoading && !jobsError && filteredJobs.length === 0 && (
                <div className="rounded-xl border border-dashed border-[var(--color-border)] bg-white/60 px-4 py-6 text-center text-sm text-[var(--color-muted)]">
                  No jobs match your current filters.
                </div>
              )}

              {!jobsLoading && !jobsError && filteredJobs.length > 0 && (
                <>
                  {/* Desktop table */}
                  <div className="hidden md:block rounded-2xl bg-[var(--color-card)] shadow-md">
                    <div className="relative overflow-auto section-scroll max-h-[520px]">
                      <table className="w-full text-xs border-separate border-spacing-0">
                        <thead className="sticky top-0 z-30 bg-white/95 backdrop-blur text-[11px] uppercase tracking-wide text-[var(--color-muted)] border-b border-[var(--color-border)]/40">
                          <tr>
                            <th className="text-left px-4 py-3">Address</th>
                            <th className="text-left px-4 py-3">Status</th>
                            <th className="text-left px-4 py-3">Stage</th>
                            <th className="text-left px-4 py-3 whitespace-nowrap">
                              Last updated
                            </th>
                            <th className="text-right px-4 py-3">Action</th>
                          </tr>
                        </thead>
                        <motion.tbody
                          variants={staggerParent}
                          initial="initial"
                          animate="animate"
                        >
                          {pagedJobs.map((job, idx) => {
                            const a = addr(job.address);
                            const felt = (job as any).feltCompletedAt
                              ? "Done"
                              : (job as any).feltScheduledFor
                              ? "Scheduled"
                              : "—";
                            const shingles = (job as any).shinglesCompletedAt
                              ? "Done"
                              : (job as any).shinglesScheduledFor
                              ? "Scheduled"
                              : "—";
                            const punch = (job as any).punchedAt
                              ? "Done"
                              : (job as any).punchScheduledFor
                              ? "Scheduled"
                              : "—";

                            return (
                              <motion.tr
                                key={job.id}
                                variants={item}
                                className={
                                  idx % 2 === 0 ? "bg-white/40" : "bg-white/20"
                                }
                              >
                                <td className="px-4 py-3">
                                  <div className="truncate max-w-[320px] font-medium text-[var(--color-text)]">
                                    {a.display || "—"}
                                  </div>
                                  {(a.city || a.state || a.zip) && (
                                    <div className="text-[11px] text-[var(--color-muted)]">
                                      {[a.city, a.state, a.zip]
                                        .filter(Boolean)
                                        .join(", ")}
                                    </div>
                                  )}
                                </td>
                                <td className="px-4 py-3">
                                  <span
                                    className={`inline-flex items-center rounded-md px-2 py-1 text-[10px] font-semibold uppercase ${statusClasses(
                                      job.status
                                    )}`}
                                  >
                                    {job.status}
                                  </span>
                                </td>
                                <td className="px-4 py-3">
                                  <div className="flex flex-wrap gap-1">
                                    <Chip label="Felt" value={felt} />
                                    <Chip label="Shingles" value={shingles} />
                                    <Chip label="Punch" value={punch} />
                                  </div>
                                </td>
                                <td className="px-4 py-3 whitespace-nowrap text-[var(--color-text)]">
                                  {fmtDateTime(job.updatedAt ?? job.createdAt)}
                                </td>
                                <td className="px-4 py-3 text-right">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      navigate(`/crew/job/${job.id}`)
                                    }
                                    className="inline-flex items-center rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-text)] hover:bg-[var(--color-card-hover)] select-none"
                                  >
                                    View
                                  </button>
                                </td>
                              </motion.tr>
                            );
                          })}
                        </motion.tbody>

                        {/* Spacer for sticky footer */}
                        <tbody aria-hidden>
                          <tr>
                            <td colSpan={5} className="h-12 p-0" />
                          </tr>
                        </tbody>
                      </table>

                      {/* Sticky footer pagination */}
                      <div className="sticky bottom-[-1px] z-30 flex items-center justify-between gap-3 border-t border-[var(--color-border)]/40 bg-white/95 px-4 py-2 backdrop-blur text-xs text-[var(--color-muted)]">
                        <span>
                          Showing {(jobsPage - 1) * JOBS_PER_PAGE + 1} –{" "}
                          {Math.min(
                            jobsPage * JOBS_PER_PAGE,
                            filteredJobs.length
                          )}{" "}
                          of {filteredJobs.length}
                        </span>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            disabled={jobsPage === 1}
                            onClick={() =>
                              setJobsPage((p) => Math.max(1, p - 1))
                            }
                            className="rounded border border-[var(--color-border)] px-2 py-1 disabled:opacity-40"
                          >
                            Prev
                          </button>
                          <span>
                            Page {jobsPage} / {jobsTotalPages}
                          </span>
                          <button
                            type="button"
                            disabled={jobsPage === jobsTotalPages}
                            onClick={() =>
                              setJobsPage((p) =>
                                Math.min(jobsTotalPages, p + 1)
                              )
                            }
                            className="rounded border border-[var(--color-border)] px-2 py-1 disabled:opacity-40"
                          >
                            Next
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Mobile cards */}
                  <motion.div
                    className="md:hidden mt-3 grid gap-3"
                    variants={staggerParent}
                    initial="initial"
                    animate="animate"
                  >
                    {pagedJobs.map((job) => {
                      const a = addr(job.address);
                      const felt = (job as any).feltCompletedAt
                        ? "Done"
                        : (job as any).feltScheduledFor
                        ? "Scheduled"
                        : "—";
                      const shingles = (job as any).shinglesCompletedAt
                        ? "Done"
                        : (job as any).shinglesScheduledFor
                        ? "Scheduled"
                        : "—";
                      const punch = (job as any).punchedAt
                        ? "Done"
                        : (job as any).punchScheduledFor
                        ? "Scheduled"
                        : "—";

                      return (
                        <motion.button
                          key={job.id}
                          variants={item}
                          type="button"
                          onClick={() => navigate(`/crew/job/${job.id}`)}
                          className="text-left rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)]/80 px-4 py-3 shadow-sm hover:bg-[var(--color-card-hover)] transition"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="truncate text-sm font-semibold text-[var(--color-text)]">
                                {a.display || "—"}
                              </div>
                              <div className="mt-1 text-[11px] text-[var(--color-muted)]">
                                Last updated{" "}
                                {fmtDateTime(job.updatedAt ?? job.createdAt)}
                              </div>
                            </div>
                            <span
                              className={`shrink-0 rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase ${statusClasses(
                                job.status
                              )}`}
                            >
                              {job.status}
                            </span>
                          </div>

                          <div className="mt-2 flex flex-wrap gap-2">
                            <Chip label="Felt" value={felt} />
                            <Chip label="Shingles" value={shingles} />
                            <Chip label="Punch" value={punch} />
                          </div>
                        </motion.button>
                      );
                    })}

                    {/* Mobile pagination */}
                    <div className="mt-1 flex items-center justify-between text-xs text-[var(--color-muted)]">
                      <span>
                        Showing {(jobsPage - 1) * JOBS_PER_PAGE + 1} –{" "}
                        {Math.min(
                          jobsPage * JOBS_PER_PAGE,
                          filteredJobs.length
                        )}{" "}
                        of {filteredJobs.length}
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={jobsPage === 1}
                          onClick={() => setJobsPage((p) => Math.max(1, p - 1))}
                          className="rounded border border-[var(--color-border)] px-2 py-1 disabled:opacity-40"
                        >
                          Prev
                        </button>
                        <span>
                          {jobsPage}/{jobsTotalPages}
                        </span>
                        <button
                          type="button"
                          disabled={jobsPage === jobsTotalPages}
                          onClick={() =>
                            setJobsPage((p) => Math.min(jobsTotalPages, p + 1))
                          }
                          className="rounded border border-[var(--color-border)] px-2 py-1 disabled:opacity-40"
                        >
                          Next
                        </button>
                      </div>
                    </div>
                  </motion.div>
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.section>

      {/* Payout history */}
      <motion.section
        className="mt-8 rounded-2xl bg-white/60 hover:bg-white transition duration-300 ease-in-out p-4 sm:p-6 shadow-md hover:shadow-lg"
        {...fadeUp(0.12)}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div>
              <h2 className="text-xl sm:text-2xl font-semibold text-[var(--color-text)]">
                Payout History
              </h2>
              <p className="mt-1 text-xs text-[var(--color-muted)]">
                Your generated payout stubs (draft & paid).
              </p>
            </div>
            <button
              type="button"
              onClick={() => setPayoutsOpen((v) => !v)}
              className="inline-flex items-center text-xs border border-[var(--color-border)] bg-[var(--color-brown-hover)] hover:bg-[var(--color-brown)] cursor-pointer transition duration-300 ease-in-out px-3 py-1 text-white"
            >
              <ChevronDown
                className={`h-4 w-4 transition-transform ${
                  payoutsOpen ? "rotate-0" : "-rotate-90"
                }`}
              />
              <span className="ml-2 hidden sm:inline">
                {payoutsOpen ? "Collapse" : "Expand"}
              </span>
            </button>
          </div>

          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--color-muted)]" />
            <input
              value={stubSearch}
              onChange={(e) => setStubSearch(e.target.value)}
              placeholder="Search stubs…"
              className="w-full sm:w-72 rounded-lg border border-[var(--color-border)] bg-white/80 pl-9 pr-3 py-2 text-sm text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
            />
          </div>
        </div>

        <AnimatePresence initial={false}>
          {payoutsOpen && (
            <motion.div
              className="mt-5"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.25, ease: EASE }}
            >
              {stubsLoading && (
                <div className="text-sm text-[var(--color-muted)]">
                  Loading payout history…
                </div>
              )}
              {stubsError && (
                <div className="text-sm text-red-600">{stubsError}</div>
              )}

              {!stubsLoading && !stubsError && filteredStubs.length === 0 && (
                <div className="rounded-xl border border-dashed border-[var(--color-border)] bg-white/60 px-4 py-6 text-center text-sm text-[var(--color-muted)]">
                  No payout stubs yet.
                </div>
              )}

              {!stubsLoading && !stubsError && filteredStubs.length > 0 && (
                <div className="relative overflow-auto section-scroll max-h-[460px]">
                  <motion.ul
                    className="divide-y divide-[var(--color-border)] rounded-xl bg-white/70"
                    variants={staggerParent}
                    initial="initial"
                    animate="animate"
                  >
                    {pagedStubs.map((s) => {
                      const createdLabel = fmtDateTime(s.createdAt);
                      const paidLabel = s.paidAt ? fmtDateTime(s.paidAt) : null;

                      const statusPill =
                        s.status === "paid"
                          ? "bg-emerald-100 text-emerald-700"
                          : s.status === "void"
                          ? "bg-slate-200 text-slate-700"
                          : "bg-yellow-100 text-yellow-800";

                      return (
                        <motion.li
                          key={s.id}
                          variants={item}
                          className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between"
                        >
                          <div>
                            <div className="text-sm font-semibold text-[var(--color-text)]">
                              {s.number}
                            </div>
                            <div className="mt-0.5 text-[11px] text-[var(--color-muted)]">
                              Created {createdLabel}
                              {paidLabel ? ` • Paid ${paidLabel}` : ""}
                            </div>
                          </div>

                          <div className="flex items-center gap-4">
                            <div className="text-right">
                              <div className="text-[11px] text-[var(--color-muted)]">
                                Total
                              </div>
                              <div className="text-sm font-semibold text-[var(--color-text)]">
                                {money(s.totalCents)}
                              </div>
                            </div>

                            <span
                              className={`rounded-full px-2 py-1 text-[10px] font-semibold uppercase ${statusPill}`}
                            >
                              {s.status}
                            </span>
                          </div>
                        </motion.li>
                      );
                    })}
                  </motion.ul>

                  {/* Sticky pagination footer */}
                  <div className="sticky bottom-[-1px] z-30 flex items-center justify-between gap-3 border-t border-[var(--color-border)]/40 bg-white/95 px-4 py-2 backdrop-blur text-xs text-[var(--color-muted)]">
                    <span>
                      Showing {(stubsPage - 1) * STUBS_PER_PAGE + 1} –{" "}
                      {Math.min(
                        stubsPage * STUBS_PER_PAGE,
                        filteredStubs.length
                      )}{" "}
                      of {filteredStubs.length} stubs
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={stubsPage === 1}
                        onClick={() => setStubsPage((p) => Math.max(1, p - 1))}
                        className="rounded border border-[var(--color-border)] px-2 py-1 disabled:opacity-40"
                      >
                        Prev
                      </button>
                      <span>
                        Page {stubsPage} / {stubsTotalPages}
                      </span>
                      <button
                        type="button"
                        disabled={stubsPage === stubsTotalPages}
                        onClick={() =>
                          setStubsPage((p) => Math.min(stubsTotalPages, p + 1))
                        }
                        className="rounded border border-[var(--color-border)] px-2 py-1 disabled:opacity-40"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.section>
    </div>
  );
}
