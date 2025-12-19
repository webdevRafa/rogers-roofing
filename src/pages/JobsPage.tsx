import { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  where,
  query,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import type { FieldValue } from "firebase/firestore";
import { db } from "../firebase/firebaseConfig";
import type { Job, JobStatus, Employee } from "../types/types";
import { jobConverter } from "../types/types";
import { recomputeJob, makeAddress } from "../utils/calc";
import { useOrg } from "../contexts/OrgContext";
import { DashboardJobsSection } from "../features/dashboard/DashboardJobsSection";

// Chart.js imports for summary visualisations
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  ArcElement,
  Title as ChartTitle,
  Tooltip as ChartTooltip,
  Legend as ChartLegend,
  type ChartData,
  type ChartOptions,
  type TooltipItem,
} from "chart.js";
import { Bar, Pie } from "react-chartjs-2";

// Register chart modules
ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  ArcElement,
  ChartTitle,
  ChartTooltip,
  ChartLegend
);

/* Small helpers matching DashboardPage */
type FsTimestampLike = { toDate: () => Date };
function isFsTimestamp(x: unknown): x is FsTimestampLike {
  return typeof (x as FsTimestampLike)?.toDate === "function";
}
function toMillis(x: unknown): number | null {
  if (x == null) return null;
  if (x instanceof Date) return x.getTime();
  if (typeof x === "number") return x;
  if (isFsTimestamp(x)) return x.toDate().getTime();
  if (typeof x === "string") {
    const d = new Date(x);
    return Number.isNaN(d.getTime()) ? null : d.getTime();
  }
  return null;
}
const toYMD = (d: Date): string => {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};
function formatYmdForChip(ymd: string | ""): string {
  if (!ymd) return "…";
  const [yearStr, monthStr, dayStr] = ymd.split("-");
  const year = Number(yearStr);
  const monthIndex = Number(monthStr) - 1;
  const day = Number(dayStr);
  const date = new Date(year, monthIndex, day);
  if (Number.isNaN(date.getTime())) return "…";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

type StatusFilter = "all" | JobStatus;

/** Format cents into dollar string (e.g. $1,234.56). */
function formatCurrency(cents: number | null | undefined): string {
  const value = (cents ?? 0) / 100;
  return `$${value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Pick a displayable address line from a Job's address. */
function pickAddressLine(a: Job["address"]): string {
  if (typeof a === "string") return a;
  return a?.fullLine ?? "";
}

/* Main page component */
export default function JobsPage() {
  const { orgId, loading: membershipLoading } = useOrg();

  // Jobs & employees
  const [jobs, setJobs] = useState<Job[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  // Form & creation state
  const [openForm, setOpenForm] = useState(false);
  const [address, setAddress] = useState("");
  const [newFeltDate, setNewFeltDate] = useState("");
  const [newShinglesDate, setNewShinglesDate] = useState("");
  const [newPunchDate, setNewPunchDate] = useState("");
  const [assignedEmployeeIds, setAssignedEmployeeIds] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Search & filter state
  const [showSearch, setShowSearch] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [datePreset, setDatePreset] = useState<
    "custom" | "last7" | "thisMonth" | "ytd"
  >("custom");

  // Sort option state
  const [sortOption, setSortOption] = useState<"recent" | "netDesc" | "netAsc">(
    "recent"
  );

  // Pagination
  const [jobsPage, setJobsPage] = useState(1);
  const JOBS_PER_PAGE = 20;
  const [jobsOpen, setJobsOpen] = useState(true);

  // Load jobs from Firestore
  useEffect(() => {
    if (!orgId) return;
    const q = query(
      collection(db, "jobs").withConverter(jobConverter),
      where("orgId", "==", orgId),
      orderBy("updatedAt", "desc")
    );
    const unsub = onSnapshot(q, (snap) => {
      setJobs(snap.docs.map((d) => d.data()));
    });
    return () => unsub();
  }, [orgId]);

  // Load active employees for assignment list
  useEffect(() => {
    if (!orgId) return;
    const q = query(
      collection(db, "employees"),
      where("orgId", "==", orgId),
      where("isActive", "==", true)
    );
    const unsub = onSnapshot(q, (snap) => {
      setEmployees(
        snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<Employee, "id">),
        }))
      );
    });
    return () => unsub();
  }, [orgId]);

  // Create a new job
  async function createJob() {
    if (!orgId) return;
    setCreating(true);
    setError(null);
    try {
      if (!address.trim()) {
        throw new Error("Please enter a job address.");
      }
      const newRef = doc(collection(db, "jobs"));
      let job: Job = {
        id: newRef.id,
        orgId,
        status: "pending",
        address: makeAddress(address),
        assignedEmployeeIds,
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
        createdAt: serverTimestamp() as unknown as FieldValue,
        updatedAt: serverTimestamp() as unknown as FieldValue,
        computed: { totalExpensesCents: 0, netProfitCents: 0 },
      };
      if (newFeltDate)
        job.feltScheduledFor = new Date(newFeltDate + "T00:00:00");
      if (newShinglesDate)
        job.shinglesScheduledFor = new Date(newShinglesDate + "T00:00:00");
      if (newPunchDate)
        job.punchScheduledFor = new Date(newPunchDate + "T00:00:00");
      job = recomputeJob(job);
      await setDoc(newRef.withConverter(jobConverter), job);
      // reset form
      setAddress("");
      setAssignedEmployeeIds([]);
      setNewFeltDate("");
      setNewShinglesDate("");
      setNewPunchDate("");
      setOpenForm(false);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setCreating(false);
    }
  }

  // Filtered jobs based on search, status & dates
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
        const addressStr = [j.address?.toString() ?? ""]
          .join(" ")
          .toLowerCase();
        if (!addressStr.includes(term)) return false;
      }
      return true;
    });
  }, [jobs, statusFilter, startDate, endDate, searchTerm]);

  // Sort filtered jobs based on selected option
  const sortedJobs = useMemo(() => {
    const arr = [...filteredJobs];
    if (sortOption === "netDesc") {
      return arr.sort(
        (a, b) =>
          (b.computed?.netProfitCents ?? 0) - (a.computed?.netProfitCents ?? 0)
      );
    } else if (sortOption === "netAsc") {
      return arr.sort(
        (a, b) =>
          (a.computed?.netProfitCents ?? 0) - (b.computed?.netProfitCents ?? 0)
      );
    } else {
      // default: most recent updatedAt
      return arr.sort((a, b) => {
        const aTs = toMillis(a.updatedAt ?? a.createdAt) ?? 0;
        const bTs = toMillis(b.updatedAt ?? b.createdAt) ?? 0;
        return bTs - aTs;
      });
    }
  }, [filteredJobs, sortOption]);

  // Pagination & totals based on sorted jobs
  const jobsTotalPages = Math.max(
    1,
    Math.ceil(sortedJobs.length / JOBS_PER_PAGE)
  );
  const pagedJobs = useMemo(() => {
    const start = (jobsPage - 1) * JOBS_PER_PAGE;
    return sortedJobs.slice(start, start + JOBS_PER_PAGE);
  }, [sortedJobs, jobsPage]);
  const totalNet = useMemo(
    () =>
      sortedJobs.reduce((acc, j) => acc + (j.computed?.netProfitCents ?? 0), 0),
    [sortedJobs]
  );
  const totalEarnings = useMemo(
    () =>
      sortedJobs.reduce(
        (acc, j) => acc + (j.earnings?.totalEarningsCents ?? 0),
        0
      ),
    [sortedJobs]
  );
  const totalExpenses = useMemo(
    () =>
      sortedJobs.reduce(
        (acc, j) => acc + (j.computed?.totalExpensesCents ?? 0),
        0
      ),
    [sortedJobs]
  );
  const averageProfit = useMemo(
    () => (sortedJobs.length > 0 ? totalNet / sortedJobs.length : 0),
    [totalNet, sortedJobs.length]
  );
  const highestProfit = useMemo(() => {
    let max = 0;
    sortedJobs.forEach((j) => {
      const n = j.computed?.netProfitCents ?? 0;
      if (n > max) max = n;
    });
    return max;
  }, [sortedJobs]);

  // Build filters dynamically from statuses present
  const dynamicStatusOptions: JobStatus[] = useMemo(() => {
    const set = new Set<JobStatus>();
    jobs.forEach((j) => set.add(j.status));
    return Array.from(set);
  }, [jobs]);
  const filters: StatusFilter[] = ["all", ...dynamicStatusOptions];

  // Date preset helpers
  function recomputeDates(p: typeof datePreset, now = new Date()) {
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
  function applyPreset(p: typeof datePreset) {
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
  useEffect(() => {
    if (datePreset === "custom") return;
    recomputeDates(datePreset);
    let timer = setTimeout(function tick() {
      recomputeDates(datePreset);
      timer = setTimeout(tick, msUntilNextMidnight());
    }, msUntilNextMidnight());
    return () => clearTimeout(timer);
  }, [datePreset]);

  // Determine active date filter label
  const hasActiveDateFilter =
    datePreset !== "custom" || Boolean(startDate || endDate);
  const presetLabel =
    datePreset === "last7"
      ? "Last 7 days"
      : datePreset === "thisMonth"
      ? "This month"
      : datePreset === "ytd"
      ? "Year to date"
      : null;
  const rangeLabel =
    presetLabel ??
    (startDate || endDate
      ? `${formatYmdForChip(startDate)} → ${formatYmdForChip(endDate)}`
      : null);

  // Compute status counts across all jobs (unfiltered) for summary
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    jobs.forEach((j) => {
      counts[j.status] = (counts[j.status] ?? 0) + 1;
    });
    return counts;
  }, [jobs]);

  // Chart: status distribution
  const statusLabels = useMemo(() => Object.keys(statusCounts), [statusCounts]);
  const statusValues = useMemo(
    () => statusLabels.map((l) => statusCounts[l] ?? 0),
    [statusLabels, statusCounts]
  );
  const statusColors = useMemo(() => {
    // simple palette; cycle through if more statuses
    const palette = [
      "#fbbf24",
      "#34d399",
      "#60a5fa",
      "#c084fc",
      "#f87171",
      "#facc15",
      "#818cf8",
      "#f472b6",
    ];
    return statusLabels.map((_, idx) => palette[idx % palette.length]);
  }, [statusLabels]);
  const statusChartData: ChartData<"pie", number[], string> = {
    labels: statusLabels,
    datasets: [
      {
        label: "Jobs by Status",
        data: statusValues,
        backgroundColor: statusColors,
        borderWidth: 1,
      },
    ],
  };
  const statusChartOptions: ChartOptions<"pie"> = {
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: "bottom",
        labels: {
          boxWidth: 12,
          font: { size: 10 },
          color: "#333",
        },
      },
      title: { display: false },
      tooltip: {},
    },
  };

  // Chart: top jobs by net profit
  const topJobs = useMemo(() => {
    const arr = [...sortedJobs];
    arr.sort(
      (a, b) =>
        (b.computed?.netProfitCents ?? 0) - (a.computed?.netProfitCents ?? 0)
    );
    return arr.slice(0, 5);
  }, [sortedJobs]);
  const topJobLabels = topJobs.map((j) => {
    const line = pickAddressLine(j.address);
    return line.length > 30 ? line.slice(0, 27) + "…" : line;
  });
  const topJobValues = topJobs.map(
    (j) => (j.computed?.netProfitCents ?? 0) / 100
  );
  const topJobsData: ChartData<"bar", number[], string> = {
    labels: topJobLabels,
    datasets: [
      {
        label: "Net Profit ($)",
        data: topJobValues,
        backgroundColor: "#0e7490",
        borderColor: "#0e7490",
        borderWidth: 1,
      },
    ],
  };
  const topJobsOptions: ChartOptions<"bar"> = {
    indexAxis: "y",
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: false,
      },
      tooltip: {
        callbacks: {
          label: (context: TooltipItem<"bar">) => {
            const value = context.parsed.x;
            return `$${Number(value).toFixed(2)}`;
          },
        },
      },
      title: { display: false },
    },
    scales: {
      x: {
        beginAtZero: true,
        ticks: {
          callback: (value) => `$${value}`,
        },
      },
      y: {
        ticks: {
          autoSkip: false,
        },
      },
    },
  };

  // Guard: show loading or no org message
  const isBusy = membershipLoading;
  const hasOrg = Boolean(orgId);
  if (isBusy) return <div className="p-6 text-sm">Loading organization…</div>;
  if (!hasOrg)
    return (
      <div className="p-6 text-sm">
        You are not linked to an organization. Please contact your admin.
      </div>
    );

  return (
    <div className="min-h-screen bg-gradient-to-b ">
      {/* Main content */}
      <div className="mx-auto w-[min(1100px,94vw)] space-y-8 py-8">
        {/* Jobs overview section */}
        <section className="rounded-2xl border border-[var(--color-border)]/60 bg-white/90 p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-[var(--color-text)]">
            Jobs Overview
          </h2>
          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {/* Total jobs */}
            <div className="rounded-xl bg-white/60 p-4 shadow-md border border-[var(--color-border)]/40">
              <div className="text-xl font-semibold text-[var(--color-text)]">
                {sortedJobs.length}
              </div>
              <div className="text-xs uppercase tracking-wide text-[var(--color-muted)]">
                Total Jobs
              </div>
            </div>
            {/* Total earnings */}
            <div className="rounded-xl bg-white/60 p-4 shadow-md border border-[var(--color-border)]/40">
              <div className="text-xl font-semibold text-[var(--color-text)]">
                {formatCurrency(totalEarnings)}
              </div>
              <div className="text-xs uppercase tracking-wide text-[var(--color-muted)]">
                Total Earnings
              </div>
            </div>
            {/* Total expenses */}
            <div className="rounded-xl bg-white/60 p-4 shadow-md border border-[var(--color-border)]/40">
              <div className="text-xl font-semibold text-[var(--color-text)]">
                {formatCurrency(totalExpenses)}
              </div>
              <div className="text-xs uppercase tracking-wide text-[var(--color-muted)]">
                Total Expenses
              </div>
            </div>
            {/* Net profit */}
            <div className="rounded-xl bg-white/60 p-4 shadow-md border border-[var(--color-border)]/40">
              <div className="text-xl font-semibold text-[var(--color-text)]">
                {formatCurrency(totalNet)}
              </div>
              <div className="text-xs uppercase tracking-wide text-[var(--color-muted)]">
                Net Profit
              </div>
            </div>
            {/* Avg. profit */}
            <div className="rounded-xl bg-white/60 p-4 shadow-md border border-[var(--color-border)]/40">
              <div className="text-xl font-semibold text-[var(--color-text)]">
                {formatCurrency(Math.round(averageProfit))}
              </div>
              <div className="text-xs uppercase tracking-wide text-[var(--color-muted)]">
                Avg. Profit/Job
              </div>
            </div>
            {/* Highest profit */}
            <div className="rounded-xl bg-white/60 p-4 shadow-md border border-[var(--color-border)]/40">
              <div className="text-xl font-semibold text-[var(--color-text)]">
                {formatCurrency(highestProfit)}
              </div>
              <div className="text-xs uppercase tracking-wide text-[var(--color-muted)]">
                Highest Profit
              </div>
            </div>
          </div>
          {/* Charts row */}
          <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2">
            <div className="rounded-xl bg-white/60 p-4 shadow-md border border-[var(--color-border)]/40">
              <h3 className="mb-2 text-sm font-semibold text-[var(--color-text)]">
                Job Status Distribution
              </h3>
              <div className="relative h-64 w-full">
                <Pie data={statusChartData} options={statusChartOptions} />
              </div>
            </div>
            <div className="rounded-xl bg-white/60 p-4 shadow-md border border-[var(--color-border)]/40">
              <h3 className="mb-2 text-sm font-semibold text-[var(--color-text)]">
                Top Jobs by Profit
              </h3>
              <div className="relative h-64 w-full">
                <Bar data={topJobsData} options={topJobsOptions} />
              </div>
            </div>
          </div>
        </section>

        {/* Sort options */}
        <div className="rounded-xl border border-[var(--color-border)]/60 bg-white/90 p-3 shadow-sm flex flex-col sm:flex-row sm:items-center gap-3">
          <label className="text-sm font-medium text-[var(--color-text)]">
            Sort by:
          </label>
          <select
            value={sortOption}
            onChange={(e) => setSortOption(e.target.value as any)}
            className="rounded border border-[var(--color-border)] bg-white px-3 py-1.5 text-sm text-[var(--color-text)] focus:outline-none"
          >
            <option value="recent">Most recent</option>
            <option value="netDesc">Highest net profit</option>
            <option value="netAsc">Lowest net profit</option>
          </select>
        </div>

        {/* Job status summary */}
        <section className="rounded-2xl border border-[var(--color-border)]/60 bg-white/90 p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-[var(--color-text)]">
            Job Status Summary
          </h2>
          <div className="mt-2 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {Object.entries(statusCounts).map(([status, count]) => (
              <div
                key={status}
                className="flex flex-col rounded-lg border border-[var(--color-border)] bg-white/70 p-3 shadow-sm"
              >
                <span className="text-[11px] uppercase tracking-wide text-[var(--color-muted)]">
                  {status}
                </span>
                <span className="mt-1 text-xl font-bold text-[var(--color-text)]">
                  {count}
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* Jobs list section using existing DashboardJobsSection component */}
        <section className="rounded-2xl border border-[var(--color-border)]/60 bg-white/90 p-4 shadow-sm">
          <DashboardJobsSection
            jobsOpen={jobsOpen}
            setJobsOpen={setJobsOpen}
            showSearch={showSearch}
            setShowSearch={setShowSearch}
            searchTerm={searchTerm}
            setSearchTerm={setSearchTerm}
            showFilters={showFilters}
            setShowFilters={setShowFilters}
            hasActiveDateFilter={hasActiveDateFilter}
            rangeLabel={rangeLabel}
            setDatePreset={setDatePreset}
            startDate={startDate}
            endDate={endDate}
            setStartDate={setStartDate}
            setEndDate={setEndDate}
            applyPreset={applyPreset}
            employees={employees}
            assignedEmployeeIds={assignedEmployeeIds}
            setAssignedEmployeeIds={setAssignedEmployeeIds}
            filters={filters}
            statusFilter={statusFilter}
            setStatusFilter={setStatusFilter}
            newFeltDate={newFeltDate}
            setNewFeltDate={setNewFeltDate}
            newShinglesDate={newShinglesDate}
            setNewShinglesDate={setNewShinglesDate}
            newPunchDate={newPunchDate}
            setNewPunchDate={setNewPunchDate}
            openForm={openForm}
            setOpenForm={setOpenForm}
            address={address}
            setAddress={setAddress}
            createJob={createJob}
            loading={creating}
            error={error}
            filteredJobs={sortedJobs}
            pagedJobs={pagedJobs}
            jobsPage={jobsPage}
            jobsTotalPages={jobsTotalPages}
            setJobsPage={setJobsPage}
            JOBS_PER_PAGE={JOBS_PER_PAGE}
            totalNet={totalNet}
          />
        </section>
      </div>
    </div>
  );
}
