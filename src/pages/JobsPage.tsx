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
import type {
  Job,
  JobStatus,
  PayoutDoc,
  Employee,
  EmployeeAddress,
} from "../types/types";

import { jobConverter } from "../types/types";
import { recomputeJob, makeAddress } from "../utils/calc";
import { Link, useNavigate } from "react-router-dom"; // ✅ navigate after create
import { getAuth, signOut } from "firebase/auth";

import { motion, AnimatePresence, type MotionProps } from "framer-motion";
import CountUp from "react-countup";
import { Search, Filter, ChevronDown } from "lucide-react";
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
// Normalize Employee.address into a consistent shape
function normalizeEmployeeAddress(
  a: Employee["address"]
): EmployeeAddress | null {
  if (!a) return null;
  if (typeof a === "string") return { fullLine: a, line1: a };
  return a as EmployeeAddress;
}

// ----------- Date Preset logic (auto-rolling) -----------
type DatePreset = "custom" | "last7" | "thisMonth" | "ytd";

// COMPONENT BEGINS HERE

export default function JobsPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [openForm, setOpenForm] = useState(false);
  const [address, setAddress] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [signingOut, setSigningOut] = useState(false);

  // ✅ collapsible sections
  const [jobsOpen, setJobsOpen] = useState(true);
  const [payoutsOpen, setPayoutsOpen] = useState(true);

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

  const totalNet = useMemo(
    () =>
      filteredJobs.reduce(
        (acc, j) => acc + (j.computed?.netProfitCents ?? 0),
        0
      ),
    [filteredJobs]
  );
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
    (startDate || endDate ? `${startDate || "…"} → ${endDate || "…"}` : null);

  // JSX BEGINS HERE
  return (
    <>
      <div>
        <div className="bg-gradient-to-tr from-[var(--color-logo)] via-red-950 to-[var(--color-logo)]">
          <nav className="top-0 z-10 backdrop-blur">
            <div className="mx-auto max-w-[1200px] flex items-center justify-between py-10 px-4 md:px-0">
              <div className="text-lg md:text-3xl font-poppins text-white  uppercase flex justify-between w-full items-center">
                Roger's Roofing & Contracting LLC
                <img
                  className="max-w-[100px] md:max-w-[150px] rounded-2xl shadow-md"
                  src={logo}
                  alt=""
                />
              </div>
            </div>
          </nav>
        </div>

        {/* MAIN NAV BUTTONS */}
        <div className="max-w-[1200px] mx-auto mt-5 flex gap-5 justify-center">
          <button
            onClick={() => navigate("/employees")}
            className="rounded-lg border border-[var(--color-border)] px-4 py-1.5 text-xs text-[var(--color-text)] hover:bg-[var(--color-card-hover)]"
          >
            Employees
          </button>
          <button
            onClick={() => setOpenForm((v) => !v)}
            className=" rounded-lg bg-cyan-800 hover:bg-cyan-700 transition duration-300 ease-in-out text-[var(--btn-text)] px-4 py-1.5 text-xs"
          >
            + New Job
          </button>
          <button
            onClick={() => navigate("/punches")}
            className="rounded-lg border border-[var(--color-border)] px-4 py-1.5 text-xs text-[var(--color-text)] hover:bg-[var(--color-card-hover)]"
          >
            Punch calendar
          </button>

          <button
            onClick={handleLogout}
            disabled={signingOut}
            className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-text)] hover:bg-red-100 disabled:opacity-50"
            title="Sign out"
          >
            {signingOut ? "Signing out…" : "Logout"}
          </button>
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
            <div className="flex items-center gap-2">
              <h1 className="text-xl sm:text-2xl font-bold text-[var(--color-text)]">
                My Jobs
              </h1>
              <button
                type="button"
                onClick={() => setJobsOpen((v) => !v)}
                className="inline-flex items-center rounded-full border border-[var(--color-border)] bg-white/70 px-2 py-1 text-xs text-[var(--color-muted)] hover:bg-[var(--color-card-hover)]"
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

            <div className="flex flex-row gap-2 sm:flex-row sm:items-center">
              {/* Search toggle */}
              <div className="relative">
                <button
                  onClick={() => setShowSearch((v) => !v)}
                  className="inline-flex items-center justify-center rounded-xl   px-3 py-2 text-sm text-[var(--color-text)] hover:bg-[var(--color-card-hover)] w-full sm:w-auto"
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

              {/* ✅ NEW: Filter dates toggle + active-chip */}
              <div>
                <button
                  onClick={() => setShowFilters((v) => !v)}
                  className="inline-flex items-center justify-center rounded-xl  px-3 py-2 text-sm text-[var(--color-text)] hover:bg-[var(--color-card-hover)]"
                  title="Filter by date"
                  aria-expanded={showFilters}
                  aria-controls="date-filters"
                >
                  <Filter size={16} className="mr-2" />
                  {showFilters ? "Hide filters" : "Filter dates"}
                </button>

                {hasActiveDateFilter && (
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-white px-2 py-1 text-xs text-[var(--color-muted)] border border-[var(--color-border)]">
                      {rangeLabel}
                    </span>
                    <button
                      onClick={() => {
                        setDatePreset("custom");
                        setStartDate("");
                        setEndDate("");
                      }}
                      className="text-xs text-red-700 hover:underline"
                      title="Clear date filters"
                    >
                      Clear
                    </button>
                  </div>
                )}
              </div>
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
                  "whitespace-nowrap   px-3 py-1 text-xs uppercase tracking-wide transition-colors",
                  statusFilter === f
                    ? "bg-cyan-800 hover:bg-cyan-700 border-transparent text-white shadow-sm"
                    : "bg-transparent text-[var(--color-muted)] hover:bg-[var(--color-card-hover)]",
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
              className="mb-4 shadow-md bg-[var(--color-card)] p-4"
              {...fadeUp(0.08)}
            >
              <div className="flex w-full flex-col justify-center gap-2 sm:flex-row sm:gap-3">
                <input
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Job address (e.g., 123 Main St, San Antonio, TX)"
                  className="w-full max-w-[500px] rounded-lg border border-[var(--color-border)] bg-white/70 px-3 py-2 text-sm text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                />
                <div className="flex items-center gap-2">
                  <button
                    onClick={createJob}
                    disabled={loading}
                    className="w-full sm:w-auto  bg-cyan-800 hover:bg-cyan-700 transition duration-300 ease-in-out text-[var(--btn-text)] px-4 py-1.5 text-sm  disabled:opacity-50"
                  >
                    {loading ? "Saving..." : "Create"}
                  </button>
                </div>
              </div>
              {error && (
                <div className="mt-3 text-sm text-red-600">{error}</div>
              )}
            </motion.section>
          )}

          {/* ✅ Date range filters (hidden until toggled) */}
          <AnimatePresence initial={false}>
            {showFilters && (
              <motion.section
                id="date-filters"
                className="mb-6 rounded-xl shadow-md bg-[var(--color-card)] p-4"
                {...fadeUp(0.09)}
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.25, ease: EASE }}
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
                      className="rounded-lg bg-red-900/70 hover:bg-red-600/80 transition duration-300 ease-in-out px-3 py-2 text-xs text-white"
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
            )}
          </AnimatePresence>
          {jobsOpen && (
            <div className="mt-2 section-scroll space-y-4">
              {/* Totals */}
              <motion.div
                className="mb-0 rounded-tr-2xl p-2 text-xl font-semibold max-w-[400px] shadow-md bg-gray-50/35  text-[var(--color-text)]"
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
                              {[a.city, a.state, a.zip]
                                .filter(Boolean)
                                .join(", ")}
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
                          <div className="text-[var(--color-muted)] text-xs">
                            Net
                          </div>
                          <div
                            className={
                              (job.computed?.netProfitCents ?? 0) >= 0
                                ? "text-emerald-600 font-semibold"
                                : "text-red-600 font-semibold"
                            }
                          >
                            <CountMoney
                              cents={job.computed?.netProfitCents ?? 0}
                            />
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
                className="hidden sm:block rounded-tr-2xl  shadow-md  bg-[var(--color-card)] overflow-hidden"
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
            </div>
          )}

          {/* ====== PAYOUTS (all employees) ====== */}
          <section className="mt-10 rounded-2xl bg-[var(--color-card)] p-4 sm:p-6 shadow-md">
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
                      className="ml-1 inline-flex items-center rounded-full border border-[var(--color-border)] bg-white/70 px-2 py-1 text-xs text-[var(--color-muted)] hover:bg-[var(--color-card-hover)]"
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

                  <p className="mt-1 text-xs text-[var(--color-muted)]">
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
              <div className="mt-2 section-scroll space-y-3">
                {/* Create stub CTA (pending only, single employee only) */}
                {payoutFilter === "pending" && selectedPayoutIds.length > 0 && (
                  <div className="mb-1 flex flex-col items-end gap-1 sm:flex-row sm:items-center sm:justify-between">
                    {selectedEmployeeIds.length > 1 && (
                      <p className="text-xs text-red-700">
                        Please select payouts for a single employee to create a
                        stub.
                      </p>
                    )}

                    {canCreateStub && (
                      <button
                        type="button"
                        onClick={() => setStubOpen(true)}
                        className="rounded-lg bg-[var(--color-primary)] px-4 py-1.5 text-xs font-semibold text-white hover:bg-[var(--color-primary-600)]"
                      >
                        Create stub ({selectedPayoutIds.length})
                      </button>
                    )}
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
                  filteredPayouts.length === 0 && (
                    <p className="text-sm text-[var(--color-muted)]">
                      No payouts match the current filters.
                    </p>
                  )}

                {/* List */}
                {!payoutsLoading &&
                  !payoutsError &&
                  filteredPayouts.length > 0 && (
                    <ul className="divide-y divide-[var(--color-border)] rounded-xl bg-white/70">
                      {filteredPayouts.map((p) => {
                        const a = addr((p as any).jobAddressSnapshot as any);
                        const employeeName = payoutEmployeeName(p);
                        const isPending = !p.paidAt;
                        const isSelected = selectedPayoutIds.includes(p.id);
                        const amountCents = (p as any).amountCents ?? 0;
                        const jobId = (p as any).jobId as string | undefined;

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
              </div>
            )}
          </section>
        </motion.div>
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
type GlobalPayoutStubModalProps = {
  payouts: PayoutDoc[];
  employee: Employee | null;
  onClose: () => void;
  onConfirmPaid: () => Promise<void>;
  saving: boolean;
};

function GlobalPayoutStubModal({
  payouts,
  employee,
  onClose,
  onConfirmPaid,
  saving,
}: GlobalPayoutStubModalProps) {
  const totalCents = payouts.reduce(
    (sum, p) => sum + ((p as any).amountCents ?? 0),
    0
  );

  // Use the helper we created earlier to normalize the employee address
  const empAddr = employee ? normalizeEmployeeAddress(employee.address) : null;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
      <div className="w-full max-w-3xl rounded-2xl bg-white p-6 shadow-xl">
        {/* Header */}
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold">
              Roger&apos;s Roofing &amp; Contracting LLC
            </h2>
            {/* Static company address */}
            <h1>3618 Angus Crossing</h1>
            <p className="mt-0 text-xs">San Antonio, Texas 75245</p>

            {/* Dynamic employee info */}
            {employee && (
              <>
                <h1 className="mt-3 mb-0 text-lg">
                  <span className="font-medium">{employee.name}</span>
                </h1>
                {empAddr && (
                  <h1 className="mt-[-3px] text-md">
                    {empAddr.fullLine ||
                      [empAddr.line1, empAddr.city, empAddr.state, empAddr.zip]
                        .filter(Boolean)
                        .join(", ")}
                  </h1>
                )}
              </>
            )}
          </div>
          <div className="text-right text-xs text-gray-500">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-gray-300 px-2 py-1 text-[11px] text-gray-600 hover:bg-gray-100 print:hidden"
            >
              Close
            </button>
          </div>
        </div>

        {/* Table – KEEP everything you already have below this line:
            the Address / SqCount / Rate / Total table,
            the "Number of payouts" text, Print / Save PDF,
            and "Mark all as paid" button.
        */}

        {/* Table – ONLY Address / SqCount / Rate / Total */}
        <div className="mt-4 overflow-hidden rounded-xl border border-gray-200">
          <table className="min-w-full text-xs sm:text-sm">
            <thead className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-3 py-2 text-left">Address</th>
                <th className="px-3 py-2 text-left">SqCount</th>
                <th className="px-3 py-2 text-left">Rate</th>
                <th className="px-3 py-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {payouts.map((p) => {
                const a = addr((p as any).jobAddressSnapshot as any);
                return (
                  <tr key={p.id} className="border-t border-gray-100">
                    <td className="px-3 py-2 align-top">
                      <div className="font-medium text-gray-900">
                        {a.display || "—"}
                      </div>
                      {(a.city || a.state || a.zip) && (
                        <div className="text-[11px] text-gray-500">
                          {[a.city, a.state, a.zip].filter(Boolean).join(", ")}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 align-top text-sm text-gray-800">
                      {typeof (p as any).sqft === "number"
                        ? (p as any).sqft.toLocaleString()
                        : "—"}
                    </td>
                    <td className="px-3 py-2 align-top text-sm text-gray-800">
                      {typeof (p as any).ratePerSqFt === "number"
                        ? `$${(p as any).ratePerSqFt.toFixed(2)}/sq.ft`
                        : "—"}
                    </td>
                    <td className="px-3 py-2 align-top text-right text-sm font-semibold text-gray-900">
                      {money((p as any).amountCents ?? 0)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Totals + actions (same as EmployeeDetailPage stub) */}
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm text-gray-700">
            <div className="print:hidden">
              <span className="font-medium">Number of payouts:</span>{" "}
              {payouts.length}
            </div>
            <div className="mt-1 text-lg font-semibold">
              Total: {money(totalCents)}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => window.print()}
              className="rounded-md border border-gray-300 px-3 py-2 text-xs text-gray-700 hover:bg-gray-100 print:hidden"
            >
              Print / Save PDF
            </button>
            <button
              type="button"
              onClick={onConfirmPaid}
              disabled={saving}
              className="rounded-md bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-60 print:hidden"
            >
              {saving ? "Marking as paid…" : "Mark all as paid"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
