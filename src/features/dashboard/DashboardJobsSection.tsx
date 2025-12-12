import type { Dispatch, SetStateAction } from "react";
import type { Job, JobStatus } from "../../types/types";
import { Link } from "react-router-dom";
import {
  motion,
  AnimatePresence,
  type MotionProps,
  type Variants,
} from "framer-motion";
import { Search, Filter, ChevronDown, SquarePlus } from "lucide-react";
import CountUp from "react-countup";

type FsTimestampLike = { toDate: () => Date };

function isFsTimestamp(x: unknown): x is FsTimestampLike {
  return typeof (x as FsTimestampLike)?.toDate === "function";
}

function toMillis(v: unknown): number | null {
  if (!v) return null;
  if (typeof v === "number") return v;
  if (v instanceof Date) return v.getTime();
  if (isFsTimestamp(v)) return v.toDate().getTime();
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
const EASE = [0.16, 1, 0.3, 1] as const;

const fadeUp = (delay = 0): MotionProps => ({
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.45, ease: EASE, delay },
});

const staggerParent: Variants = {
  initial: { opacity: 0 },
  animate: {
    opacity: 1,
    transition: { staggerChildren: 0.04, delayChildren: 0.05 },
  },
};

const item: Variants = {
  initial: { opacity: 0, y: 8 },
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
    case "completed": // ← NEW
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
function CountMoney({ cents }: { cents: number }) {
  const dollars = (cents ?? 0) / 100;

  return (
    <CountUp
      end={dollars}
      decimals={2}
      prefix="$"
      separator=","
      duration={0.4}
    />
  );
}

type StatusFilter = "all" | JobStatus;
type DatePreset = "custom" | "last7" | "thisMonth" | "ytd";

export interface DashboardJobsSectionProps {
  jobsOpen: boolean;
  setJobsOpen: Dispatch<SetStateAction<boolean>>;

  // search
  showSearch: boolean;
  setShowSearch: Dispatch<SetStateAction<boolean>>;
  searchTerm: string;
  setSearchTerm: Dispatch<SetStateAction<string>>;

  // date filters
  showFilters: boolean;
  setShowFilters: Dispatch<SetStateAction<boolean>>;
  hasActiveDateFilter: boolean;
  rangeLabel: string | null;
  // datePreset: DatePreset;
  startDate: string;
  endDate: string;
  setDatePreset: Dispatch<SetStateAction<DatePreset>>;
  setStartDate: Dispatch<SetStateAction<string>>;
  setEndDate: Dispatch<SetStateAction<string>>;
  applyPreset: (p: DatePreset) => void;

  // status filter
  filters: StatusFilter[];
  statusFilter: StatusFilter;
  setStatusFilter: Dispatch<SetStateAction<StatusFilter>>;

  newFeltDate: string;
  setNewFeltDate: (value: string) => void;
  newShinglesDate: string;
  setNewShinglesDate: (value: string) => void;
  newPunchDate: string;
  setNewPunchDate: (value: string) => void;

  // create job form
  openForm: boolean;
  setOpenForm: Dispatch<SetStateAction<boolean>>;
  address: string;
  setAddress: Dispatch<SetStateAction<string>>;
  createJob: () => Promise<void>; // ✅ reflect actual function type
  loading: boolean;
  error: string | null;

  // jobs data + pagination
  filteredJobs: Job[];
  pagedJobs: Job[];
  jobsPage: number;
  jobsTotalPages: number;
  JOBS_PER_PAGE: number;
  setJobsPage: Dispatch<SetStateAction<number>>;
  totalNet: number;
}

export function DashboardJobsSection({
  jobsOpen,
  setJobsOpen,

  showSearch,
  setShowSearch,
  searchTerm,
  setSearchTerm,

  showFilters,
  setShowFilters,
  hasActiveDateFilter,
  rangeLabel,
  setDatePreset,
  startDate,
  setStartDate,
  endDate,
  setEndDate,
  applyPreset,

  filters,
  statusFilter,
  setStatusFilter,

  newFeltDate,
  setNewFeltDate,
  newShinglesDate,
  setNewShinglesDate,
  newPunchDate,
  setNewPunchDate,
  openForm,
  setOpenForm,
  address,
  setAddress,
  createJob,
  loading,
  error,

  filteredJobs,
  pagedJobs,
  jobsPage,
  jobsTotalPages,
  setJobsPage,
  JOBS_PER_PAGE,

  totalNet,
}: DashboardJobsSectionProps) {
  return (
    <>
      {/* Header */}
      <motion.header
        className="mb-4 sm:mb-6 flex flex-wrap bg-white/60 hover:bg-white transition duration-300 ease-in-out p-6 rounded-lg shadow-md hover:shadow-lg items-center justify-start gap-2 w-full"
        {...fadeUp(0)}
      >
        <div className="flex items-center gap-2">
          <h1 className="text-xl sm:text-2xl poppins text-[var(--color-text)]">
            Jobs
          </h1>
          <button
            type="button"
            onClick={() => setJobsOpen((v) => !v)}
            className={`inline-flex bg-[var(--color-brown)] hover:bg-[var(--color-brown-hover)] items-center rounded-full border border-[var(--color-border)] px-2 py-1 text-xs text-white `}
          >
            <ChevronDown
              className={`h-4 w-4 transition-transform ${
                jobsOpen ? "rotate-0" : "-rotate-90"
              }`}
            />
            <span className="ml-1 hidden sm:inline">
              {jobsOpen ? "Collapse" : "Expand"}
            </span>
          </button>
        </div>

        <div className="flex flex-row md:gap-2 sm:flex-row sm:items-center">
          {/* Search toggle */}
          <div className="relative">
            <button
              onClick={() => setShowSearch((v) => !v)}
              className="inline-flex items-center justify-center rounded-xl px-3 py-2 text-sm text-[var(--color-text)] hover:shadow-md transition duration-300 ease-out w-full sm:w-auto"
              title="Search addresses"
              aria-label="Search addresses"
            >
              <Search size={20} className="mr-2" />
              <span className="sm:hidden">Search</span>
            </button>

            {showSearch && (
              <div className="mt-2 sm:absolute sm:right-0 sm:mt-2 w-full sm:w-80 rounded-xl border border-[var(--color-border)] bg-white p-2 shadow-lg">
                <input
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search by address…"
                  className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                />
              </div>
            )}
          </div>

          {/* Date filter toggle */}
          <button
            onClick={() => setShowFilters((v) => !v)}
            className="ml-2 inline-flex items-center justify-center rounded-xl px-3 py-2 text-xs text-[var(--color-text)] hover:shadow-md transition duration-300 ease-out"
            title="Filter by last updated date"
          >
            <Filter size={18} className="mr-2" />
            <span className="hidden sm:inline">
              {hasActiveDateFilter
                ? rangeLabel || "Custom range"
                : "Date filters"}
            </span>
            <span className="sm:hidden">Dates</span>
          </button>

          {/* Tiny chip showing active range */}
          {hasActiveDateFilter && (
            <span className="ml-2 inline-flex items-center rounded-full bg-[var(--color-card)] px-3 py-1 text-[10px] font-medium text-[var(--color-muted)]">
              <span className="mr-1 h-1.5 w-1.5 rounded-full bg-[var(--color-accent)]" />
              {rangeLabel || "Custom range"}
            </span>
          )}
        </div>

        {/* Add New Job */}
        <div className="ml-auto flex items-center">
          <button
            onClick={() => setOpenForm((v) => !v)}
            className="group relative flex items-center justify-center rounded-lg px-3 p-1 hover:shadow-md text-[var(--color-text)] transition duration-300 ease-out"
            aria-label="Add New Job"
          >
            <div className="flex items-center gap-1">
              <SquarePlus className="h-4 w-4" />
              <span className="text-xs">New</span>
            </div>
          </button>
        </div>
      </motion.header>

      {/* Status Filters (scrollable on mobile) – only when My Jobs is expanded */}
      {jobsOpen && (
        <div className="mb-4 flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {filters.map((f) => (
            <button
              key={f}
              onClick={() => setStatusFilter(f)}
              className={[
                "whitespace-nowrap px-3 py-2 text-xs uppercase tracking-wide transition-colors",
                statusFilter === f
                  ? "bg-[var(--color-brown)] hover:bg-[var(--color-brown-hover)] border-transparent text-white shadow-sm"
                  : "bg-transparent text-[var(--color-muted)] hover:bg-[var(--color-card-hover)]",
              ].join(" ")}
            >
              {f}
            </button>
          ))}
        </div>
      )}

      {/* Create Job modal */}
      {openForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <motion.div
            className="w-full max-w-md rounded-md bg-white p-5 md:py-7 md:px-20 shadow-xl"
            {...fadeUp(0.08)}
          >
            <h3 className="text-base font-semibold text-[var(--color-text)]">
              Create new job
            </h3>
            <p className="mt-1 text-xs text-[var(--color-muted)]">
              Only the address is required. You can optionally schedule felt,
              shingles, and punch.
            </p>

            <div className="mt-4 space-y-3">
              {/* Address */}
              <div>
                <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-[var(--color-muted)]">
                  Job address<span className="text-red-500">*</span>
                </label>
                <input
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="123 Main St, San Antonio, TX"
                  className="w-full rounded-lg border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                />
              </div>

              {/* Schedule fields */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-[var(--color-muted)]">
                    Schedule felt (optional)
                  </label>
                  <input
                    type="date"
                    value={newFeltDate}
                    onChange={(e) => setNewFeltDate(e.target.value)}
                    className="w-full rounded-lg border border-[var(--color-border)] bg-white px-2 py-1.5 text-xs text-[var(--color-text)]"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-[var(--color-muted)]">
                    Schedule shingles (optional)
                  </label>
                  <input
                    type="date"
                    value={newShinglesDate}
                    onChange={(e) => setNewShinglesDate(e.target.value)}
                    className="w-full rounded-lg border border-[var(--color-border)] bg-white px-2 py-1.5 text-xs text-[var(--color-text)]"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-[var(--color-muted)]">
                    Schedule punch (optional)
                  </label>
                  <input
                    type="date"
                    value={newPunchDate}
                    onChange={(e) => setNewPunchDate(e.target.value)}
                    className="w-full rounded-lg border border-[var(--color-border)] bg-white px-2 py-1.5 text-xs text-[var(--color-text)]"
                  />
                </div>
              </div>
            </div>

            {error && <div className="mt-3 text-xs text-red-600">{error}</div>}

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setOpenForm(false);
                  setAddress("");
                  setNewFeltDate("");
                  setNewShinglesDate("");
                  setNewPunchDate("");
                }}
                className="rounded-lg border border-[var(--color-border)] bg-white px-3 py-1.5 text-xs font-medium text-[var(--color-text)] hover:bg-[var(--color-card-hover)]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  // Let createJob handle validation & navigation
                  void createJob();
                }}
                disabled={loading}
                className="rounded-lg bg-[var(--color-brown)] px-4 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-[var(--color-brown-hover)] disabled:opacity-50"
              >
                {loading ? "Creating…" : "Create job"}
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* Date range filters */}
      <AnimatePresence initial={false}>
        {showFilters && (
          <motion.section
            id="date-filters"
            className="mb-6 rounded-xl shadow-md bg-[var(--color-card)] p-4"
            {...fadeUp(0.09)}
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center  sm:justify-between">
              <div>
                <h3 className="text-sm font-semibold text-[var(--color-text)]">
                  Filter by last updated date
                </h3>
                <p className="mt-1 text-xs text-[var(--color-muted)]">
                  Choose a quick range or set custom start / end dates.
                </p>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="flex items-center gap-2">
                  <div className="flex flex-col">
                    <label className="text-[10px] uppercase tracking-wide text-[var(--color-muted)]">
                      Start
                    </label>
                    <input
                      type="date"
                      value={startDate}
                      onChange={(e) => {
                        setDatePreset("custom");
                        setStartDate(e.target.value);
                      }}
                      className="rounded-lg border border-[var(--color-border)] bg-white px-2 py-1 text-xs text-[var(--color-text)]"
                    />
                  </div>

                  <div className="flex flex-col">
                    <label className="text-[10px] uppercase tracking-wide text-[var(--color-muted)]">
                      End
                    </label>
                    <input
                      type="date"
                      value={endDate}
                      onChange={(e) => {
                        setDatePreset("custom");
                        setEndDate(e.target.value);
                      }}
                      className="rounded-lg border border-[var(--color-border)] bg-white px-2 py-1 text-xs text-[var(--color-text)]"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
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
                    className="rounded-lg bg-red-900/70 hover:bg-red-600/80 transition duration-300 ease-in-out px-3 py-2 text-xs text-white"
                  >
                    Clear
                  </button>
                </div>
              </div>
            </div>

            <p className="mt-2 text-xs text-[var(--color-muted)]">
              Filters use each job&apos;s <strong>last updated</strong> date
              (falls back to created date).
            </p>
          </motion.section>
        )}
      </AnimatePresence>

      {/* Jobs list + totals + pagination */}
      {jobsOpen && (
        <div className="mt-2 section-scroll space-y-4">
          {/* Totals */}
          <motion.div
            className="mb-0 rounded-tr-2xl p-2 text-sm max-w-[400px] shadow-md bg-gray-50/35 text-[var(--color-text)]"
            {...fadeUp(0.1)}
          >
            Total net across {filteredJobs.length} job
            {filteredJobs.length === 1 ? "" : "s"}:{" "}
            <span className="font-semibold text-emerald-600">
              <CountMoney cents={totalNet} />
            </span>
          </motion.div>

          {/* MOBILE CARDS */}
          <div className="grid gap-3 sm:hidden">
            {pagedJobs.map((job) => {
              const a = addr(job.address);
              return (
                <div
                  key={job.id}
                  className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-2"
                >
                  <div className="flex items-center gap-2">
                    {/* Address */}
                    <div className="flex-1 min-w-0">
                      <div className="truncate text-sm font-medium text-[var(--color-text)]">
                        {a.display || "—"}
                      </div>
                    </div>

                    {/* Status pill */}
                    <span
                      className={`shrink-0 rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase ${statusClasses(
                        job.status
                      )}`}
                    >
                      {job.status}
                    </span>

                    {/* Net profit */}
                    <div
                      className={
                        (job.computed?.netProfitCents ?? 0) >= 0
                          ? "shrink-0 text-xs font-semibold text-emerald-600"
                          : "shrink-0 text-xs font-semibold text-red-600"
                      }
                    >
                      <CountMoney cents={job.computed?.netProfitCents ?? 0} />
                    </div>

                    {/* View */}
                    <Link
                      to={`/job/${job.id}`}
                      className="shrink-0 rounded-lg border border-[var(--color-border)] px-2 py-1 text-[10px] text-[var(--color-text)] hover:bg-[var(--color-card-hover)]"
                    >
                      View
                    </Link>
                  </div>
                </div>
              );
            })}

            {pagedJobs.length === 0 && (
              <div className="text-center text-[var(--color-muted)]">
                No jobs match the current filters.
              </div>
            )}
          </div>

          {/* DESKTOP TABLE */}
          <motion.div
            className="hidden sm:block rounded-tr-2xl shadow-md bg-[var(--color-card)]"
            variants={staggerParent}
            initial="initial"
            animate="animate"
          >
            <div className="max-h-[420px] overflow-y-auto overflow-x-auto section-scroll">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-white/90 text-[var(--color-muted)] backdrop-blur border-b border-[var(--color-border)]/60">
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
                  {pagedJobs.map((job, idx) => {
                    const a = addr(job.address);
                    return (
                      <motion.tr
                        key={job.id}
                        variants={item}
                        className={
                          idx % 2 === 0 ? "bg-white/40" : "bg-white/20"
                        }
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

                  {pagedJobs.length === 0 && (
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

          {/* Jobs pagination controls */}
          {filteredJobs.length > 0 && (
            <div className="mt-3 flex items-center justify-between text-xs text-[var(--color-muted)]">
              <span>
                Showing{" "}
                {filteredJobs.length === 0
                  ? 0
                  : (jobsPage - 1) * JOBS_PER_PAGE + 1}{" "}
                – {Math.min(jobsPage * JOBS_PER_PAGE, filteredJobs.length)} of{" "}
                {filteredJobs.length} jobs
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
                  Page {jobsPage} / {jobsTotalPages}
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
          )}
        </div>
      )}
    </>
  );
}
