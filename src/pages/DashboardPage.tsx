// src/pages/JobsPage.tsx
import { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import type { FieldValue } from "firebase/firestore";
import { db } from "../firebase/firebaseConfig";
import type { Job, JobStatus, PayoutDoc, Employee } from "../types/types";
import { DashboardHeader } from "../features/dashboard/DashboardHeader";
import { DashboardJobsSection } from "../features/dashboard/DashboardJobsSection";
import { DashboardProgressSection } from "../features/dashboard/DashboardProgressSection";

import { GlobalPayoutStubModal } from "../components/GlobalPayoutStubModal";

import { jobConverter } from "../types/types";
import { recomputeJob, makeAddress } from "../utils/calc";
import { useNavigate } from "react-router-dom"; // ✅ navigate after create
import { getAuth, signOut } from "firebase/auth";

import { motion } from "framer-motion";
import { ChevronDown } from "lucide-react";

// Simple money formatter for non-animated numbers (used in payouts section)
function money(cents: number | null | undefined): string {
  const v = typeof cents === "number" ? cents : 0;
  return (v / 100).toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
  });
}

// Global payouts tabs
type PayoutFilter = "all" | "pending" | "paid";

// Support all statuses + "all" filter
type StatusFilter = "all" | JobStatus;
const STATUS_OPTIONS: JobStatus[] = ["pending", "completed"];

// Small util: yyyy-mm-dd from Date (LOCAL time)
const toYMD = (d: Date) => {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

// Format a YYYY-MM-DD string into something like "Dec 8, 2025"
function formatYmdForChip(ymd: string | ""): string {
  if (!ymd) return "…"; // placeholder when start or end is missing

  const [yearStr, monthStr, dayStr] = ymd.split("-");
  const year = Number(yearStr);
  const monthIndex = Number(monthStr) - 1; // JS months are 0-based
  const day = Number(dayStr);

  const date = new Date(year, monthIndex, day);
  if (Number.isNaN(date.getTime())) return "…";

  return date.toLocaleDateString(undefined, {
    month: "short", // "Dec"
    day: "numeric", // "8"
    year: "numeric", // "2025"
  });
}

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
function payoutEmployeeName(p: PayoutDoc): string {
  const snap = (p as any).employeeNameSnapshot;
  if (!snap) return "";
  if (typeof snap === "string") return snap;

  if (typeof snap === "object") {
    return pickString(snap as Record<string, unknown>, [
      "name",
      "fullName",
      "displayName",
    ]);
  }

  return "";
}

// ----------- Date Preset logic (auto-rolling) -----------
type DatePreset = "custom" | "last7" | "thisMonth" | "ytd";

// COMPONENT BEGINS HERE

export default function DashboardPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [openForm, setOpenForm] = useState(false);
  const [address, setAddress] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [signingOut, setSigningOut] = useState(false);

  // Pagination for jobs
  const [jobsPage, setJobsPage] = useState(1);
  const JOBS_PER_PAGE = 20;

  // Pagination for payouts
  const [payoutsPage, setPayoutsPage] = useState(1);
  const PAYOUTS_PER_PAGE = 20;

  // ✅ collapsible sections
  const [jobsOpen, setJobsOpen] = useState(false);
  const [payoutsOpen, setPayoutsOpen] = useState(false);
  const [upcomingOpen, setUpcomingOpen] = useState(true); // NEW: upcoming section toggle

  // 🔁 Reschedule punch modal
  const [rescheduleJob, setRescheduleJob] = useState<Job | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState<string>("");

  // ✅ hide/show date filters
  const [showFilters, setShowFilters] = useState(false);

  // ✅ navigate to the created job
  const navigate = useNavigate();

  // Search
  const [showSearch, setShowSearch] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

  // ---- Payouts state (global, across all employees) ----
  const [payouts, setPayouts] = useState<PayoutDoc[]>([]);
  const [payoutsLoading, setPayoutsLoading] = useState(true);
  const [payoutsError, setPayoutsError] = useState<string | null>(null);
  const [payoutFilter, setPayoutFilter] = useState<PayoutFilter>("all");
  const [payoutSearch, setPayoutSearch] = useState("");

  // For "Create stub" flow on pending payouts
  const [selectedPayoutIds, setSelectedPayoutIds] = useState<string[]>([]);
  const [stubOpen, setStubOpen] = useState(false);
  const [stubSaving, setStubSaving] = useState(false);
  const [stubEmployee, setStubEmployee] = useState<Employee | null>(null);

  // Date range filter state (YYYY-MM-DD)
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [datePreset, setDatePreset] = useState<DatePreset>("custom");

  async function handleLogout() {
    try {
      setSigningOut(true);
      await signOut(getAuth());
      // optional: send them to login after sign-out
      navigate("/");
    } catch (err) {
      console.error("Logout failed:", err);
      // (optional) surface a toast or setError(String(err))
    } finally {
      setSigningOut(false);
    }
  }

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

  // Live payouts (all employees)
  useEffect(() => {
    const ref = collection(db, "payouts");
    const q = query(ref, orderBy("createdAt", "desc"));

    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: PayoutDoc[] = snap.docs.map((d) => d.data() as PayoutDoc);
        setPayouts(list);
        setPayoutsLoading(false);
        setPayoutsError(null);
      },
      (err) => {
        console.error(err);
        setPayoutsError(err.message || String(err));
        setPayoutsLoading(false);
      }
    );

    return () => unsub();
  }, []);

  // Clear selection when leaving "pending" tab
  useEffect(() => {
    if (payoutFilter !== "pending") {
      setSelectedPayoutIds([]);
      setStubOpen(false);
    }
  }, [payoutFilter]);

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

  // ---- Felt / shingles progress + "ready for punch" lists ----
  const materialProgressJobs = useMemo(() => {
    const toMs = (v: unknown): number | null => toMillis(v ?? null);

    const firstSchedule = (job: Job): number => {
      const feltSch = toMs((job as any).feltScheduledFor ?? null);
      const shSch = toMs((job as any).shinglesScheduledFor ?? null);
      const candidates = [feltSch, shSch].filter((v): v is number => v != null);
      if (candidates.length === 0) return Number.POSITIVE_INFINITY;
      return Math.min(...candidates);
    };

    return jobs
      .filter((j) => {
        // ignore fully completed / closed / archived jobs
        if (
          j.status === "completed" ||
          j.status === "closed" ||
          j.status === "archived"
        ) {
          return false;
        }

        const feltSch = toMs((j as any).feltScheduledFor ?? null);
        const shSch = toMs((j as any).shinglesScheduledFor ?? null);
        const feltDone = toMs((j as any).feltCompletedAt ?? null);
        const shDone = toMs((j as any).shinglesCompletedAt ?? null);

        // ❌ if BOTH materials are completed, this job belongs
        // only in the "ready for punch" list, not here
        if (feltDone != null && shDone != null) return false;

        // ✅ show jobs where at least one material stage is scheduled or done
        return (
          feltSch != null || shSch != null || feltDone != null || shDone != null
        );
      })
      .sort((a, b) => firstSchedule(a) - firstSchedule(b));
  }, [jobs]);

  const readyForPunchJobs = useMemo(() => {
    const toMs = (v: unknown): number | null => toMillis(v ?? null);

    return jobs
      .filter((j) => {
        // skip jobs already punched/closed
        if (
          j.status === "completed" ||
          j.status === "closed" ||
          j.status === "archived"
        ) {
          return false;
        }
        if ((j as any).punchedAt) return false;

        const feltDone = toMs((j as any).feltCompletedAt ?? null);
        const shDone = toMs((j as any).shinglesCompletedAt ?? null);

        // ready for punch only when BOTH are completed
        return feltDone != null && shDone != null;
      })
      .sort((a, b) => {
        const feltA =
          toMs((a as any).feltCompletedAt ?? null) ?? Number.MAX_VALUE;
        const shA =
          toMs((a as any).shinglesCompletedAt ?? null) ?? Number.MAX_VALUE;
        const feltB =
          toMs((b as any).feltCompletedAt ?? null) ?? Number.MAX_VALUE;
        const shB =
          toMs((b as any).shinglesCompletedAt ?? null) ?? Number.MAX_VALUE;

        const lastA = Math.max(feltA, shA);
        const lastB = Math.max(feltB, shB);
        return lastA - lastB;
      });
  }, [jobs]);

  // Reset jobs page on jobs/filter changes
  useEffect(() => {
    setJobsPage(1);
  }, [statusFilter, startDate, endDate, datePreset, searchTerm, jobs.length]);

  // Reset payouts page on payouts/filter changes
  useEffect(() => {
    setPayoutsPage(1);
  }, [payoutFilter, payoutSearch, payouts.length]);

  const totalNet = useMemo(
    () =>
      filteredJobs.reduce(
        (acc, j) => acc + (j.computed?.netProfitCents ?? 0),
        0
      ),
    [filteredJobs]
  );

  // Derive paged data from filtered arrays
  const jobsTotalPages = Math.max(
    1,
    Math.ceil(filteredJobs.length / JOBS_PER_PAGE)
  );

  const pagedJobs = useMemo(() => {
    const start = (jobsPage - 1) * JOBS_PER_PAGE;
    const end = start + JOBS_PER_PAGE;
    return filteredJobs.slice(start, end);
  }, [filteredJobs, jobsPage]);

  // ---- Filtered payouts (tab + search) ----
  const filteredPayouts = useMemo(() => {
    const term = payoutSearch.trim().toLowerCase();

    return payouts.filter((p) => {
      if (payoutFilter === "pending" && p.paidAt) return false;
      if (payoutFilter === "paid" && !p.paidAt) return false;

      if (term.length > 0) {
        const a = addr((p as any).jobAddressSnapshot as any);
        const employeeName = payoutEmployeeName(p);

        const haystack = [
          a.display,
          a.line1,
          a.city,
          a.state,
          a.zip,
          employeeName,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        if (!haystack.includes(term)) return false;
      }

      return true;
    });
  }, [payouts, payoutFilter, payoutSearch]);

  // Paged Layouts
  const payoutsTotalPages = Math.max(
    1,
    Math.ceil(filteredPayouts.length / PAYOUTS_PER_PAGE)
  );

  const pagedPayouts = useMemo(() => {
    const start = (payoutsPage - 1) * PAYOUTS_PER_PAGE;
    const end = start + PAYOUTS_PER_PAGE;
    return filteredPayouts.slice(start, end);
  }, [filteredPayouts, payoutsPage]);

  const selectedPayouts = useMemo(
    () => payouts.filter((p) => selectedPayoutIds.includes(p.id)),
    [payouts, selectedPayoutIds]
  );
  // Unique employee IDs for the currently selected payouts
  const selectedEmployeeIds = useMemo(() => {
    const ids = new Set<string>();
    for (const p of selectedPayouts) {
      const id = (p as any).employeeId as string | undefined;
      if (id) ids.add(id);
    }
    return Array.from(ids);
  }, [selectedPayouts]);

  // Only allow creating a stub when:
  // - in "pending" tab
  // - at least one payout is selected
  // - all selected payouts belong to a single employee
  const canCreateStub =
    payoutFilter === "pending" &&
    selectedPayoutIds.length > 0 &&
    selectedEmployeeIds.length === 1;

  function togglePayoutSelected(id: string) {
    setSelectedPayoutIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }
  function clearSelectedPayouts() {
    setSelectedPayoutIds([]);
  }

  async function markSelectedPayoutsAsPaid() {
    if (selectedPayoutIds.length === 0) return;
    setStubSaving(true);
    try {
      await Promise.all(
        selectedPayouts
          .filter((p) => !p.paidAt)
          .map((p) =>
            setDoc(
              doc(collection(db, "payouts"), p.id),
              { paidAt: serverTimestamp() as FieldValue },
              { merge: true }
            )
          )
      );
      setSelectedPayoutIds([]);
      setStubOpen(false);
    } catch (e) {
      console.error("Failed to mark payouts as paid", e);
      alert("Failed to mark some payouts as paid. Check console for details.");
    } finally {
      setStubSaving(false);
    }
  }
  // Load employee details for the stub when it's opened
  useEffect(() => {
    if (!stubOpen) {
      setStubEmployee(null);
      return;
    }

    if (selectedEmployeeIds.length !== 1) {
      setStubEmployee(null);
      return;
    }

    const employeeId = selectedEmployeeIds[0];
    let cancelled = false;

    (async () => {
      try {
        const ref = doc(collection(db, "employees"), employeeId);
        const snap = await getDoc(ref);
        if (!snap.exists()) return;
        if (!cancelled) {
          setStubEmployee(snap.data() as Employee);
        }
      } catch (err) {
        console.error("Failed to load employee for stub", err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [stubOpen, selectedEmployeeIds]);

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

      // go straight to the job's dynamic page
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

  function closeReschedule() {
    setRescheduleJob(null);
    setRescheduleDate("");
  }

  async function handleSaveReschedule() {
    if (!rescheduleJob || !rescheduleDate) return;

    try {
      const ref = doc(collection(db, "jobs"), rescheduleJob.id).withConverter(
        jobConverter
      );

      await setDoc(
        ref,
        {
          punchScheduledFor: new Date(rescheduleDate + "T00:00:00"),
          updatedAt: serverTimestamp() as FieldValue,
        },
        { merge: true }
      );

      closeReschedule();
    } catch (e) {
      console.error("Failed to reschedule punch", e);
      alert("Failed to reschedule punch. Please try again.");
    }
  }

  const filters: StatusFilter[] = ["all", ...STATUS_OPTIONS];

  // ✅ Active filter labeling for the compact chip
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

  // JSX BEGINS HERE
  return (
    <>
      <div>
        <DashboardHeader
          onGoToEmployees={() => navigate("/employees")}
          onGoToPunchCalendar={() => navigate("/schedule")}
          onLogout={handleLogout}
          signingOut={signingOut}
        />

        <motion.div
          className="mx-auto w-[min(1200px,94vw)] py-6 sm:py-10 "
          initial="initial"
          animate="animate"
        >
          {/* Header */}
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
            startDate={startDate}
            endDate={endDate}
            setDatePreset={setDatePreset}
            setStartDate={setStartDate}
            setEndDate={setEndDate}
            applyPreset={applyPreset}
            filters={filters}
            statusFilter={statusFilter}
            setStatusFilter={setStatusFilter}
            openForm={openForm}
            setOpenForm={setOpenForm}
            address={address}
            setAddress={setAddress}
            createJob={createJob}
            loading={loading}
            error={error}
            filteredJobs={filteredJobs}
            pagedJobs={pagedJobs}
            jobsPage={jobsPage}
            jobsTotalPages={jobsTotalPages}
            setJobsPage={setJobsPage}
            JOBS_PER_PAGE={JOBS_PER_PAGE}
            totalNet={totalNet}
          />

          {/* ====== MATERIAL PROGRESS + READY FOR PUNCH ====== */}
          <DashboardProgressSection
            upcomingOpen={upcomingOpen}
            setUpcomingOpen={setUpcomingOpen}
            materialProgressJobs={materialProgressJobs}
            readyForPunchJobs={readyForPunchJobs}
          />

          {/* ====== PAYOUTS (all employees) ====== */}
          <section className="mt-10 mb-40 rounded-2xl bg-white/60 hover:bg-white transition duration-300 ease-in-out p-4 sm:p-6 shadow-md hover:shadow-lg">
            {/* Header + controls */}
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <div>
                  <div className="flex gap-5">
                    <h2 className="text-2xl font-semibold text-[var(--color-text)]">
                      Payouts
                    </h2>
                    <button
                      type="button"
                      onClick={() => setPayoutsOpen((v) => !v)}
                      className="ml-1 inline-flex items-center text-xs rounded-full border border-[var(--color-border)] bg-[var(--color-brown)] hover:bg-[var(--color-brown-hover)] transition duration-300 ease-in-out px-2 py-0 text-white "
                    >
                      <ChevronDown
                        className={`h-4 w-4 transition-transform ${
                          payoutsOpen ? "rotate-0" : "-rotate-90"
                        }`}
                      />
                      <span className="ml-1 hidden sm:inline">
                        {payoutsOpen ? "Collapse" : "Expand"}
                      </span>
                    </button>
                  </div>

                  <p className="mt-3 text-xs text-[var(--color-muted)]">
                    View payouts across all employees. Use the Pending tab to
                    select payouts, generate a stub, and mark them as paid.
                  </p>
                </div>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <input
                  value={payoutSearch}
                  onChange={(e) => setPayoutSearch(e.target.value)}
                  placeholder="Search by address or employee…"
                  className="w-full sm:w-72 rounded-lg border border-[var(--color-border)] bg-white/80 px-3 py-1.5 text-sm text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                />

                <div className="inline-flex rounded-full border border-[var(--color-border)] bg-white/80 p-1 text-xs">
                  {(["all", "pending", "paid"] as PayoutFilter[]).map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setPayoutFilter(f)}
                      className={
                        "px-3 py-1 rounded-full capitalize " +
                        (payoutFilter === f
                          ? "bg-cyan-800 text-white"
                          : "text-[var(--color-text)] hover:bg-[var(--color-card-hover)]")
                      }
                    >
                      {f}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Collapsible content */}
            {payoutsOpen && (
              <div className="mt-2 section-scroll space-y-3 max-h-[420px] overflow-y-auto relative">
                {/* Create stub CTA (pending only, single employee only) */}
                {payoutFilter === "pending" && selectedPayoutIds.length > 0 && (
                  <div className="bg-white sticky top-0 z-20 mb-1 flex flex-col items-end gap-1 sm:flex-row sm:items-center sm:justify-between">
                    {selectedEmployeeIds.length > 1 && (
                      <p className="text-xs text-red-700">
                        Please select payouts for a single employee to create a
                        stub.
                      </p>
                    )}

                    <div className="flex flex-wrap items-center gap-2">
                      {canCreateStub && (
                        <button
                          type="button"
                          onClick={() => setStubOpen(true)}
                          className="rounded-lg bg-emerald-800 hover:bg-emerald-700 transition duration-300 ease-in-out px-3 py-1.5 text-xs font-semibold text-white"
                        >
                          Create stub ({selectedPayoutIds.length})
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={clearSelectedPayouts}
                        className="rounded-lg border border-[var(--color-border)] bg-[var(--color-primary-600)] hover:bg-[var(--color-primary)] px-3 py-1.5 text-xs font-medium text-white "
                      >
                        Clear all
                      </button>
                    </div>
                  </div>
                )}

                {/* States */}
                {payoutsLoading && (
                  <p className="text-sm text-[var(--color-muted)]">
                    Loading payouts…
                  </p>
                )}
                {payoutsError && (
                  <p className="text-sm text-red-600">{payoutsError}</p>
                )}
                {!payoutsLoading &&
                  !payoutsError &&
                  pagedPayouts.length === 0 && (
                    <p className="text-sm text-[var(--color-muted)]">
                      No payouts match the current filters.
                    </p>
                  )}

                {/* List */}
                {!payoutsLoading &&
                  !payoutsError &&
                  pagedPayouts.length > 0 && (
                    <ul className="divide-y divide-[var(--color-border)] rounded-xl bg-white/70">
                      {pagedPayouts.map((p) => {
                        const a = addr((p as any).jobAddressSnapshot as any);
                        const employeeName = payoutEmployeeName(p);
                        const isPending = !p.paidAt;
                        const isSelected = selectedPayoutIds.includes(p.id);
                        const amountCents = (p as any).amountCents ?? 0;
                        const jobId = (p as any).jobId as string | undefined;

                        const sqft = p.sqft;
                        const ratePerSqFt = p.ratePerSqFt;
                        const category = p.category;

                        const hasSqft =
                          typeof sqft === "number" && !Number.isNaN(sqft);
                        const hasRate =
                          typeof ratePerSqFt === "number" &&
                          !Number.isNaN(ratePerSqFt);

                        const categoryLabel =
                          category === "shingles"
                            ? "Shingles labor"
                            : category === "felt"
                            ? "Felt labor"
                            : category === "technician"
                            ? "Technician"
                            : undefined;

                        return (
                          <li
                            key={p.id}
                            className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between"
                          >
                            <div>
                              <div className="text-sm font-medium text-[var(--color-text)]">
                                {employeeName || "Unknown employee"}
                              </div>

                              <div className="text-xs text-[var(--color-muted)]">
                                {a.display || "—"}
                              </div>

                              {(a.city || a.state || a.zip) && (
                                <div className="text-[11px] text-[var(--color-muted)]">
                                  {[a.city, a.state, a.zip]
                                    .filter(Boolean)
                                    .join(", ")}
                                </div>
                              )}

                              {(categoryLabel || hasSqft || hasRate) && (
                                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[var(--color-muted)]">
                                  {categoryLabel && (
                                    <span className="inline-flex items-center rounded-full bg-[var(--color-primary)]/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-primary)]">
                                      {categoryLabel}
                                    </span>
                                  )}

                                  {hasSqft && (
                                    <span>{sqft!.toLocaleString()} sq ft</span>
                                  )}

                                  {hasSqft && hasRate && <span>•</span>}

                                  {hasRate && (
                                    <span>
                                      @{" "}
                                      {ratePerSqFt!.toLocaleString(undefined, {
                                        style: "currency",
                                        currency: "USD",
                                      })}
                                      /sq ft
                                    </span>
                                  )}
                                </div>
                              )}

                              <div className="mt-1 text-[11px] text-[var(--color-muted)]">
                                Created {fmtDateTime(p.createdAt)}{" "}
                                {p.paidAt
                                  ? `• Paid ${fmtDateTime(p.paidAt)}`
                                  : "• Pending"}
                              </div>
                            </div>

                            <div className="flex items-center gap-4">
                              <div className="text-right">
                                <div className="text-[11px] text-[var(--color-muted)]">
                                  Amount
                                </div>
                                <div className="text-sm font-semibold text-[var(--color-text)]">
                                  {money(amountCents)}
                                </div>
                              </div>

                              {/* View Job button (if payout has a jobId) */}
                              {jobId && (
                                <button
                                  type="button"
                                  onClick={() => navigate(`/job/${jobId}`)}
                                  className="rounded-md border border-[var(--color-border)] px-3 py-1 text-[11px] text-[var(--color-text)] hover:bg-[var(--color-card-hover)]"
                                >
                                  View Job
                                </button>
                              )}

                              {/* Status pill on the right */}
                              {isPending ? (
                                <span className="rounded-full bg-yellow-100 px-2 py-1 text-[10px] font-semibold uppercase text-yellow-800">
                                  Pending
                                </span>
                              ) : (
                                <span className="rounded-full bg-emerald-100 px-2 py-1 text-[10px] font-semibold uppercase text-emerald-700">
                                  Paid
                                </span>
                              )}

                              {/* Checkbox only on Pending tab */}
                              {payoutFilter === "pending" && (
                                <label className="flex items-center gap-2 text-xs text-[var(--color-muted)]">
                                  <input
                                    type="checkbox"
                                    className="h-4 w-4 rounded border-[var(--color-border)] text-[var(--color-primary)] focus:ring-[var(--color-accent)]"
                                    checked={isSelected}
                                    onChange={() => togglePayoutSelected(p.id)}
                                  />
                                  Select
                                </label>
                              )}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                {/* Payouts pagination controls */}
                {filteredPayouts.length > 0 && (
                  <div className="mt-3 flex items-center justify-between text-xs text-[var(--color-muted)]">
                    <span>
                      Showing{" "}
                      {filteredPayouts.length === 0
                        ? 0
                        : (payoutsPage - 1) * PAYOUTS_PER_PAGE + 1}{" "}
                      –{" "}
                      {Math.min(
                        payoutsPage * PAYOUTS_PER_PAGE,
                        filteredPayouts.length
                      )}{" "}
                      of {filteredPayouts.length} payouts
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={payoutsPage === 1}
                        onClick={() =>
                          setPayoutsPage((p) => Math.max(1, p - 1))
                        }
                        className="rounded border border-[var(--color-border)] px-2 py-1 disabled:opacity-40"
                      >
                        Prev
                      </button>
                      <span>
                        Page {payoutsPage} / {payoutsTotalPages}
                      </span>
                      <button
                        type="button"
                        disabled={payoutsPage === payoutsTotalPages}
                        onClick={() =>
                          setPayoutsPage((p) =>
                            Math.min(payoutsTotalPages, p + 1)
                          )
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
          </section>
        </motion.div>

        {/* 🔁 Reschedule punch modal */}
        {rescheduleJob && (
          <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
            <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
              <h3 className="text-lg font-semibold text-[var(--color-text)]">
                Reschedule punch
              </h3>

              <p className="mt-1 text-xs text-[var(--color-muted)]">
                Choose a new date for this punch. This will update the
                job&apos;s <strong>punchScheduledFor</strong> field and reflect
                in the Punch Calendar and this Upcoming list.
              </p>

              <div className="mt-4 rounded-lg bg-[var(--color-card)]/40 px-3 py-2 text-sm">
                <div className="font-medium">
                  {addr(rescheduleJob.address).display || "—"}
                </div>
              </div>

              <div className="mt-4">
                <label className="mb-1 block text-xs text-[var(--color-muted)]">
                  New punch date
                </label>
                <input
                  type="date"
                  value={rescheduleDate}
                  onChange={(e) => setRescheduleDate(e.target.value)}
                  className="w-full rounded-lg border border-[var(--color-border)] bg-white/80 px-3 py-2 text-sm text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                />
              </div>

              <div className="mt-6 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={closeReschedule}
                  className="rounded-lg border border-[var(--color-border)] bg-white px-3 py-1.5 text-xs text-[var(--color-text)] hover:bg-[var(--color-card-hover)]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveReschedule}
                  disabled={!rescheduleDate}
                  className="rounded-lg bg-[var(--color-brown)] px-4 py-1.5 text-xs font-semibold text-white hover:bg-[var(--color-brown-hover)] disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  Save date
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
      {stubOpen && selectedPayouts.length > 0 && (
        <GlobalPayoutStubModal
          payouts={selectedPayouts}
          employee={stubEmployee}
          onClose={() => setStubOpen(false)}
          onConfirmPaid={markSelectedPayoutsAsPaid}
          saving={stubSaving}
        />
      )}
    </>
  );
}
