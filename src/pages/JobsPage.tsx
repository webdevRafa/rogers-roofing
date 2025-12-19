// src/pages/JobsPage.tsx
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
import { useNavigate } from "react-router-dom";

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

/* Main page component */
export default function JobsPage() {
  const navigate = useNavigate();
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

  // Pagination
  const [jobsPage, setJobsPage] = useState(1);
  const JOBS_PER_PAGE = 20;
  const [jobsOpen, setJobsOpen] = useState(true); // keep jobs list expanded by default

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
      navigate(`/job/${newRef.id}`);
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

  // Pagination & totals
  const jobsTotalPages = Math.max(
    1,
    Math.ceil(filteredJobs.length / JOBS_PER_PAGE)
  );
  const pagedJobs = useMemo(() => {
    const start = (jobsPage - 1) * JOBS_PER_PAGE;
    return filteredJobs.slice(start, start + JOBS_PER_PAGE);
  }, [filteredJobs, jobsPage]);
  const totalNet = useMemo(
    () =>
      filteredJobs.reduce(
        (acc, j) => acc + (j.computed?.netProfitCents ?? 0),
        0
      ),
    [filteredJobs]
  );

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

  // Compute status counts for summary
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    jobs.forEach((j) => {
      counts[j.status] = (counts[j.status] ?? 0) + 1;
    });
    return counts;
  }, [jobs]);

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
        {/* Status summary */}
        <section className="rounded-2xl border border-[var(--color-border)]/60 bg-white/90 p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-[var(--color-text)]">
            Job status summary
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
            filteredJobs={filteredJobs}
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
