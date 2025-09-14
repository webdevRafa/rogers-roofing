// src/pages/JobDetailPage.tsx
// NOTE: This page uses framer-motion and react-countup.
// Install:  npm i framer-motion react-countup lucide-react
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import {
  collection,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  Timestamp,
  FieldValue,
  deleteDoc,
} from "firebase/firestore";
import { motion, type MotionProps } from "framer-motion";
import CountUp from "react-countup";
import { Pencil } from "lucide-react"; // ✏️ edit icon
import InvoiceCreateModal from "../components/InvoiceCreateModal";

import { db } from "../firebase/firebaseConfig";
import type {
  Job,
  Payout,
  MaterialExpense,
  Note,
  JobStatus,
  JobAttachment,
  MaterialCategory,
} from "../types/types";
import { jobConverter } from "../types/types";
import { toCents } from "../utils/money";
import { recomputeJob } from "../utils/calc";

// Optional label helper for union JobAttachment
function getAttachmentLabel(p: JobAttachment): string {
  if ("label" in p && typeof p.label === "string") return p.label;
  if (
    "caption" in p &&
    typeof (p as { caption?: unknown }).caption === "string"
  ) {
    return (p as { caption: string }).caption;
  }
  return "";
}

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

// ---------- Status helpers ----------
const STATUS_OPTIONS: JobStatus[] = [
  "draft",
  "active",
  "pending",
  "invoiced",
  "paid",
  "closed",
  "archived",
];

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

// ---------- Money display ----------
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

// ---------- Timestamp helpers ----------
type FsTimestampLike = { toDate: () => Date };
function isFsTimestamp(x: unknown): x is FsTimestampLike {
  return typeof (x as FsTimestampLike)?.toDate === "function";
}
function toMillis(x: unknown): number | null {
  if (x == null) return null;
  let d: Date | null = null;
  if (isFsTimestamp(x)) d = x.toDate();
  else if (x instanceof Date) d = x;
  else if (typeof x === "string" || typeof x === "number") {
    const parsed = new Date(x);
    if (!Number.isNaN(parsed.getTime())) d = parsed;
  }
  return d ? d.getTime() : null;
}
function fmtDate(x: unknown): string {
  const ms = toMillis(x);
  return ms == null ? "—" : new Date(ms).toLocaleString();
}

export default function JobDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [job, setJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [invoiceModalOpen, setInvoiceModalOpen] = useState(false);

  // --- NEW: pricing edit toggle ---
  const [editingPricing, setEditingPricing] = useState(false);

  // --- Pricing calculator state (used only while editing/initial apply) ---
  const [sqft, setSqft] = useState<string>("");
  const [rate, setRate] = useState<31 | 35>(31); // $31 or $35
  const totalJobPayCentsPreview = useMemo(() => {
    const nSqft = Math.max(0, Number(sqft) || 0);
    return Math.round((nSqft * rate + 35) * 100);
  }, [sqft, rate]);

  // --- Material form state (category + unit price + quantity + vendor)
  const [material, setMaterial] = useState<{
    category: MaterialCategory;
    unitPrice: string; // dollars
    quantity: string; // integer
    vendor: string;
  }>({
    category: "coilNails",
    unitPrice: "",
    quantity: "",
    vendor: "",
  });

  const [noteText, setNoteText] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");
  const [photoLabel, setPhotoLabel] = useState("");
  // Tabs for payouts
  type PayoutTab = "shingles" | "felt" | "technician";
  const [payoutTab, setPayoutTab] = useState<PayoutTab>("shingles");
  const payeeRef = useRef<HTMLInputElement | null>(null);
  const materialRef = useRef<HTMLSelectElement | null>(null);
  const noteRef = useRef<HTMLInputElement | null>(null);
  const photoRef = useRef<HTMLInputElement | null>(null);
  // Keep separate inputs per tab (name, sqft, rate)
  const [payoutInputs, setPayoutInputs] = useState<
    Record<
      PayoutTab,
      { payeeNickname: string; sqft: string; rate: string; amount: string }
    >
  >({
    shingles: { payeeNickname: "", sqft: "", rate: "", amount: "" },
    felt: { payeeNickname: "", sqft: "", rate: "", amount: "" },
    technician: { payeeNickname: "", sqft: "", rate: "", amount: "" }, // amount is used here
  });

  // Convenience getter/setter for the active tab’s inputs
  const activePayout = payoutInputs[payoutTab];
  function setActivePayout(
    next: Partial<{
      payeeNickname: string;
      sqft: string;
      rate: string;
      amount: string;
    }>
  ) {
    setPayoutInputs((s) => ({
      ...s,
      [payoutTab]: { ...s[payoutTab], ...next },
    }));
  }

  const payoutAmountCents = useMemo(() => {
    if (payoutTab === "technician") {
      const amt = Number(activePayout.amount) || 0;
      return Math.round(Math.max(0, amt) * 100);
    }
    const sqft = Number(activePayout.sqft) || 0;
    const rate = Number(activePayout.rate) || 0;
    return Math.round(Math.max(0, sqft * rate) * 100);
  }, [payoutTab, activePayout.amount, activePayout.sqft, activePayout.rate]);

  // Load job
  useEffect(() => {
    let cancelled = false;
    async function run() {
      try {
        const ref = doc(collection(db, "jobs"), id as string).withConverter(
          jobConverter
        );
        const snap = await getDoc(ref);
        if (!snap.exists()) throw new Error("Job not found");
        const data = snap.data();
        if (!cancelled) {
          setJob(data);

          // Initialize local pricing state from persisted pricing (for edit mode)
          if (data.pricing) {
            setSqft(String(data.pricing.sqft ?? ""));
            setRate((data.pricing.ratePerSqFt as 31 | 35) ?? 31);
          }
        }
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    if (id) run();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const totals = useMemo(() => {
    const earnings = job?.earnings?.totalEarningsCents ?? 0;
    const payouts = job?.expenses?.totalPayoutsCents ?? 0;
    const materials = job?.expenses?.totalMaterialsCents ?? 0;
    const expenses = job?.computed?.totalExpensesCents ?? 0;
    const net = job?.computed?.netProfitCents ?? earnings - expenses;
    const expensePortion = earnings > 0 ? Math.min(1, expenses / earnings) : 0;
    return { earnings, payouts, materials, expenses, net, expensePortion };
  }, [job]);

  // Save (optimistic, typed)
  async function saveJob(nextJob: Job) {
    const ref = doc(collection(db, "jobs"), nextJob.id).withConverter(
      jobConverter
    );
    const previous = job;

    try {
      // Optimistic: client-time to avoid "Invalid Date"
      const optimistic = recomputeJob({
        ...nextJob,
        updatedAt: Timestamp.now(),
      });
      setJob(optimistic);

      // Persist with server time
      const toPersist = recomputeJob({
        ...nextJob,
        updatedAt: serverTimestamp() as FieldValue,
      });
      await setDoc(ref, toPersist, { merge: true });

      // Re-read authoritative doc
      const snap = await getDoc(ref);
      if (snap.exists()) setJob(snap.data());
    } catch (err) {
      console.error("Failed to save job", err);
      if (previous) setJob(previous);
    }
  }

  // ---- Status mutation ----
  async function setStatus(status: JobStatus) {
    if (!job) return;
    await saveJob({ ...job, status });
  }

  // ---- Mutations ----
  async function addPayout() {
    if (!job) return;

    const name = activePayout.payeeNickname.trim();
    if (!name) return;

    let entry: Payout;

    if (payoutTab === "technician") {
      const amt = Number(activePayout.amount);
      if (!Number.isFinite(amt) || amt <= 0) return;

      entry = {
        id: crypto.randomUUID(),
        payeeNickname: name,
        amountCents: payoutAmountCents,
        method: "check",
        paidAt: Timestamp.now(),
        category: "technician",
      };
    } else {
      const sqft = Number(activePayout.sqft);
      const rate = Number(activePayout.rate);
      if (
        !Number.isFinite(sqft) ||
        !Number.isFinite(rate) ||
        sqft <= 0 ||
        rate <= 0
      )
        return;

      entry = {
        id: crypto.randomUUID(),
        payeeNickname: name,
        amountCents: payoutAmountCents,
        method: "check",
        paidAt: Timestamp.now(),
        sqft,
        ratePerSqFt: rate,
        category: payoutTab,
      };
    }

    const updated: Job = {
      ...job,
      expenses: {
        ...job.expenses,
        payouts: [...(job.expenses.payouts ?? []), entry],
      },
    };

    await saveJob(updated);

    // clear only the active tab’s form
    setPayoutInputs((s) => ({
      ...s,
      [payoutTab]: { payeeNickname: "", sqft: "", rate: "", amount: "" },
    }));
    payeeRef.current?.focus();
  }

  async function addMaterial() {
    if (!job) return;

    const qty = Number(material.quantity);
    const unit = Number(material.unitPrice);
    if (!Number.isFinite(qty) || !Number.isFinite(unit) || qty <= 0 || unit < 0)
      return;

    const vendor = material.vendor?.trim();

    const entry: MaterialExpense = {
      id: crypto.randomUUID(),
      category: material.category,
      unitPriceCents: toCents(unit),
      quantity: Math.floor(qty),
      ...(vendor ? { vendor } : {}),
      createdAt: Timestamp.now(),
      amountCents: toCents(unit * qty),
    };

    const currentMaterials = job.expenses?.materials ?? [];
    const updated: Job = {
      ...job,
      expenses: {
        ...(job.expenses ?? {}),
        materials: [...currentMaterials, entry],
      },
    };

    await saveJob(updated);

    setMaterial({
      category: "coilNails",
      unitPrice: "",
      quantity: "",
      vendor: "",
    });
    materialRef.current?.focus();
  }

  async function addNote() {
    if (!job || !noteText.trim()) return;
    const entry: Note = {
      id: crypto.randomUUID(),
      text: noteText.trim(),
      createdAt: Timestamp.now(),
    };
    const updated: Job = { ...job, notes: [...(job.notes ?? []), entry] };
    await saveJob(updated);
    setNoteText("");
    noteRef.current?.focus();
  }

  // ------- Attachments (JobAttachment[]) -------
  async function addPhoto() {
    if (!job || !photoUrl.trim()) return;
    const entry: JobAttachment = {
      url: photoUrl.trim(),
      ...(photoLabel.trim() ? { label: photoLabel.trim() } : {}),
    };
    const updated: Job = {
      ...job,
      attachments: [...(job.attachments ?? []), entry],
    };
    await saveJob(updated);
    setPhotoUrl("");
    setPhotoLabel("");
    photoRef.current?.focus();
  }

  async function removePhoto(url: string) {
    if (!job) return;
    const updated: Job = {
      ...job,
      attachments: (job.attachments ?? []).filter((p) => p.url !== url),
    };
    await saveJob(updated);
  }

  async function removePayout(pid: string) {
    if (!job) return;
    const updated: Job = {
      ...job,
      expenses: {
        ...job.expenses,
        payouts: (job.expenses.payouts ?? []).filter((p) => p.id !== pid),
      },
    };
    await saveJob(updated);
  }

  async function removeMaterial(mid: string) {
    if (!job) return;
    const updated: Job = {
      ...job,
      expenses: {
        ...job.expenses,
        materials: (job.expenses.materials ?? []).filter((m) => m.id !== mid),
      },
    };
    await saveJob(updated);
  }

  async function removeNote(nid: string) {
    if (!job) return;
    const updated: Job = {
      ...job,
      notes: (job.notes ?? []).filter((n) => n.id !== nid),
    };
    await saveJob(updated);
  }

  // ------- NEW: Danger zone — permanent delete -------
  async function permanentlyDeleteJob() {
    if (!job) return;
    const label = job.address?.fullLine ?? job.id;

    const confirmText = window.prompt(
      `Type DELETE to permanently remove "${label}". This cannot be undone.`
    );
    if (confirmText !== "DELETE") return;

    try {
      await deleteDoc(doc(collection(db, "jobs"), job.id));
      navigate("/"); // back to list
    } catch (e) {
      console.error("Failed to permanently delete job", e);
      alert("Failed to delete the job. Check console for details.");
    }
  }

  if (loading)
    return <div className="p-8 text-[var(--color-text)]">Loading…</div>;
  if (error) return <div className="p-8 text-red-600">{error}</div>;
  if (!job) return <div className="p-8">Not found.</div>;

  const last = job.updatedAt ?? job.createdAt ?? null;
  const lastStr = fmtDate(last);

  // Persisted pricing presence
  const hasPricing =
    job.pricing &&
    Number.isFinite(job.pricing.sqft) &&
    Number.isFinite(job.pricing.ratePerSqFt);

  // Values to display in the summary (live edit values if editing, otherwise persisted)
  const displaySqft = editingPricing
    ? Number(sqft || 0)
    : job.pricing?.sqft ?? 0;
  const displayRate = editingPricing
    ? rate
    : (job.pricing?.ratePerSqFt as 31 | 35) ?? 31;
  const displayTotal = editingPricing
    ? totalJobPayCentsPreview
    : job.earnings?.totalEarningsCents ??
      Math.round((displaySqft * displayRate + 35) * 100);

  return (
    <motion.div
      className="mx-auto max-w-[1400px] mt-20 py-8"
      variants={staggerParent}
      initial="initial"
      animate="animate"
    >
      {/* Header */}
      <motion.div
        className="mb-6 flex flex-wrap items-center justify-between gap-3"
        {...fadeUp(0)}
      >
        <div>
          <Link
            to="/"
            className="text-sm text-[var(--color-primary)] hover:underline"
          >
            &larr; Back
          </Link>
          <h1 className="mt-2 text-4xl font-bold text-[var(--color-logo)]">
            {job.address?.fullLine}
          </h1>
          <div className="text-sm text-[var(--color-muted)]">
            Last updated: {lastStr}
          </div>
        </div>

        <div className="flex w-full flex-col items-end gap-2 sm:w-auto">
          {/* Status pill + selector */}
          <div className="flex items-center gap-2">
            <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-1 text-xs uppercase tracking-wide text-[var(--color-muted)]">
              Status:
              <span
                className={`ml-2 rounded-full px-2 py-0.5 ${statusClasses(
                  job.status as JobStatus
                )}`}
              >
                {job.status}
              </span>
            </span>
            <select
              value={job.status}
              onChange={(e) => setStatus(e.target.value as JobStatus)}
              className="rounded-lg border border-[var(--color-border)] bg-white/80 px-2 py-1 text-xs text-[var(--color-text)] focus:ring-2 focus:ring-[var(--color-accent)]"
              title="Change job status"
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          {/* PRICING: show editor only when not set OR when editingPricing=true */}
          {!hasPricing || editingPricing ? (
            <div className="rounded-2xl shadow-md px-5 py-3 text-right w-full sm:w-auto">
              <div className="mb-2 text-xs text-[var(--color-muted)]">
                Total Job Pay
              </div>
              <div className="text-2xl font-semibold text-[var(--color-text)]">
                <CountMoney cents={totalJobPayCentsPreview} />
              </div>

              <div className="mt-3 flex items-center gap-2 text-xs">
                <input
                  value={sqft}
                  onChange={(e) => setSqft(e.target.value)}
                  type="number"
                  min={0}
                  step="1"
                  placeholder="Sq. ft"
                  className="w-24 rounded-md border border-[var(--color-border)] bg-white/80 px-2 py-1 text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                />
                <select
                  value={rate}
                  onChange={(e) => setRate(Number(e.target.value) as 31 | 35)}
                  className="w-20 rounded-md border border-[var(--color-border)] bg-white/80 px-2 py-1 text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                  title="Pay rate"
                >
                  <option value={31}>$31</option>
                  <option value={35}>$35</option>
                </select>
                <span className="text-[var(--color-muted)]">+ $35 fee</span>
                <button
                  onClick={() => {
                    if (!job) return;
                    const nSqft = Math.max(0, Number(sqft) || 0);
                    const updated: Job = {
                      ...job,
                      pricing: {
                        sqft: nSqft,
                        ratePerSqFt: rate,
                        feeCents: 3500,
                      },
                      earnings: {
                        ...job.earnings,
                        totalEarningsCents: Math.round(
                          (nSqft * rate + 35) * 100
                        ),
                      },
                    };
                    void saveJob(updated);
                    setEditingPricing(false); // collapse editor after save
                  }}
                  className="ml-2 rounded-md bg-cyan-800 hover:bg-cyan-700 transition duration-300 ease-in-out px-3 py-1 text-[var(--btn-text)]"
                >
                  Apply
                </button>
                {hasPricing && (
                  <button
                    onClick={() => {
                      // cancel edit -> reset inputs to persisted values
                      setSqft(String(job.pricing?.sqft ?? ""));
                      setRate((job.pricing?.ratePerSqFt as 31 | 35) ?? 31);
                      setEditingPricing(false);
                    }}
                    className="rounded-md border border-[var(--color-border)] bg-white px-3 py-1"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </div>
          ) : (
            // COMPACT SUMMARY (read-only) with pencil to edit
            <div className="flex w-full items-stretch justify-end gap-2 sm:w-auto">
              <div className="rounded-xl shadow-md bg-white px-4 py-2 text-right">
                <div className="text-[10px] uppercase tracking-wide text-[var(--color-muted)]">
                  Sq. ft @ Rate
                </div>
                <div className="text-sm font-medium  text-[var(--color-text)]">
                  {Number(displaySqft || 0).toLocaleString()} sq.ft @ $
                  {displayRate}/sq.ft <span className="opacity-70">+ $35</span>
                </div>
              </div>

              <div className="rounded-2xl shadow-md px-5 py-3 text-right bg-white">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-xs text-[var(--color-muted)]">
                      Total Job Pay
                    </div>
                    <div className="text-2xl font-semibold text-[var(--color-text)]">
                      <CountMoney cents={displayTotal} />
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      // prime inputs from persisted pricing and enter edit mode
                      setSqft(String(job.pricing?.sqft ?? ""));
                      setRate((job.pricing?.ratePerSqFt as 31 | 35) ?? 31);
                      setEditingPricing(true);
                    }}
                    title="Edit pricing"
                    className="shrink-0 rounded-full shadow-md 
                    px-3 text-xs py-2 text-[var(--color-logo)] bg-[var(--color-accent)]/4 p-2 hover:bg-[var(--color-card-hover)]"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => setInvoiceModalOpen(true)}
                    className="rounded-md 
                     px-3 text-xs py-2 text-[var(--color-logo)] bg-[var(--color-accent)]/4 shadow-md"
                    title="Create invoice or receipt"
                  >
                    Create Invoice / Receipt
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </motion.div>

      {/* Stat row + profit bar */}
      <motion.div className="rounded-2xl shadow-md p-4" {...fadeUp(0.05)}>
        <div className="grid gap-4 sm:grid-cols-4 ">
          <Stat label="Payouts" cents={totals.payouts} />
          <Stat label="Materials" cents={totals.materials} />
          <Stat label="All Expenses" cents={totals.expenses} />
          <div
            className={` rounded-xl ${
              totals.net > 0 ? "bg-emerald-400/3" : "bg-red-400/3"
            }`}
          >
            <Stat label="Profit" cents={totals.net} />
          </div>
        </div>
        <div className="mt-4">
          <div className="flex items-center justify-between text-xs text-[var(--color-muted)]">
            <span>Expenses</span>
            <span>
              <CountMoney cents={totals.expenses} /> /{" "}
              <CountMoney cents={totals.earnings} />
            </span>
          </div>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-black/10">
            <motion.div
              className="h-full bg-[var(--color-primary)]"
              initial={{ width: 0 }}
              animate={{ width: `${totals.expensePortion * 100}%` }}
              transition={{ duration: 0.6, ease: EASE }}
              aria-label="Expense portion of earnings"
            />
          </div>
        </div>
      </motion.div>

      {/* Quick edit / add panel */}
      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        {/* Payouts */}
        <MotionCard title="Payouts" delay={0.1}>
          {/* Tabs */}
          <div className="mb-3 inline-flex rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-1 text-xs">
            {(["shingles", "felt", "technician"] as PayoutTab[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setPayoutTab(t)}
                className={
                  "px-3 py-1 rounded-md capitalize " +
                  (payoutTab === t
                    ? "bg-cyan-800 hover:bg-cyan-700 transition duration-300 ease-in-out text-[var(--btn-text)]"
                    : "text-[var(--color-text)] hover:bg-[var(--color-card-hover)]")
                }
              >
                {t}
              </button>
            ))}
          </div>

          {/* Form for ACTIVE tab only (same formula: sqft × rate) */}
          <form
            className={
              payoutTab === "technician"
                ? "grid gap-2 sm:grid-cols-[1fr_160px_auto]"
                : "grid gap-2 sm:grid-cols-[1fr_120px_120px_auto]"
            }
            onSubmit={(e) => {
              e.preventDefault();
              addPayout();
            }}
          >
            <input
              ref={payeeRef}
              value={activePayout.payeeNickname}
              onChange={(e) =>
                setActivePayout({ payeeNickname: e.target.value })
              }
              placeholder={`Payee name (${payoutTab})`}
              className="rounded-lg border border-[var(--color-border)] bg-white/80 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
            />

            {payoutTab === "technician" ? (
              // Flat-amount input
              <input
                value={activePayout.amount}
                onChange={(e) => setActivePayout({ amount: e.target.value })}
                type="number"
                min={0}
                step="0.01"
                placeholder="Amount $"
                className="rounded-lg border border-[var(--color-border)] bg-white/80 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
              />
            ) : (
              <>
                <input
                  value={activePayout.sqft}
                  onChange={(e) => setActivePayout({ sqft: e.target.value })}
                  type="number"
                  min={0}
                  step="1"
                  placeholder="Sq. ft"
                  className="rounded-lg border border-[var(--color-border)] bg-white/80 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                />
                <input
                  value={activePayout.rate}
                  onChange={(e) => setActivePayout({ rate: e.target.value })}
                  type="number"
                  min={0}
                  step="0.01"
                  placeholder="Rate $/sq.ft"
                  className="rounded-lg border border-[var(--color-border)] bg-white/80 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                />
              </>
            )}

            <button className="rounded-lg bg-cyan-800 hover:bg-cyan-700 transition duration-300 ease-in-out px-3 py-2 text-sm text-[var(--btn-text)] ">
              Add
            </button>
          </form>

          {/* Live preview for the active tab */}
          <div className="mt-2 text-xs text-[var(--color-muted)]">
            Computed payout ({payoutTab}):{" "}
            <span className="font-medium text-[var(--color-text)]">
              ${(payoutAmountCents / 100).toFixed(2)}
            </span>{" "}
            ({activePayout.sqft || 0} sq.ft × ${activePayout.rate || 0}/sq.ft)
          </div>

          {/* Existing list */}
          <ul className="mt-3 rounded-lg bg-white/70">
            {(job?.expenses?.payouts ?? []).map((p) => (
              <motion.li
                key={p.id}
                className="mb-2 flex items-center justify-between rounded-lg bg-[var(--color-accent)]/2 p-3 shadow-md"
                variants={item}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span className="font-medium text-[var(--color-text)]">
                    {p.payeeNickname}
                  </span>
                  {typeof p.sqft === "number" &&
                    typeof p.ratePerSqFt === "number" && (
                      <div className="text-[11px] text-[var(--color-muted)]">
                        {p.sqft.toLocaleString()} sq.ft × ${p.ratePerSqFt}/sq.ft
                      </div>
                    )}
                  {p.category && (
                    <span className="rounded-full bg-black/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-[var(--color-text)]">
                      {p.category}
                    </span>
                  )}
                  <span className="ml-2 text-xs text-[var(--color-muted)]">
                    {p.paidAt ? fmtDate(p.paidAt) : ""}
                  </span>
                </div>

                <div className="flex items-center gap-3">
                  <CountMoney
                    cents={p.amountCents}
                    className="text-sm text-[var(--color-text)]"
                  />
                  <button
                    onClick={() => removePayout(p.id)}
                    className="rounded-md border border-[var(--color-border)] bg-white px-2 py-1 text-xs text-[var(--color-muted)] hover:bg-[var(--color-card-hover)]"
                    title="Delete"
                  >
                    Delete
                  </button>
                </div>
              </motion.li>
            ))}
            {(job?.expenses?.payouts ?? []).length === 0 && (
              <li className="p-3 text-sm text-[var(--color-muted)]">
                No payouts yet.
              </li>
            )}
          </ul>
        </MotionCard>

        {/* Materials */}
        <MotionCard title="Materials" delay={0.15}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              addMaterial();
            }}
            className="grid items-start gap-2 max-w-full md:grid-cols-[minmax(0,1fr)_120px_100px_160px_auto]  sm:grid-cols-2"
          >
            {/* Category */}
            <select
              ref={materialRef}
              value={material.category}
              onChange={(e) =>
                setMaterial((s) => ({
                  ...s,
                  category: e.target.value as MaterialCategory,
                }))
              }
              className="min-w-0 rounded-lg border border-[var(--color-border)] bg-white/80 px-2 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
              title="Material category"
            >
              <option value="coilNails">Coil Nails (per box)</option>
              <option value="tinCaps">Tin Caps (per box)</option>
              <option value="plasticJacks">Plastic Jacks (per unit)</option>
              <option value="counterFlashing">
                Flashing — Counter (per unit)
              </option>
              <option value="jFlashing">Flashing — J/L (per unit)</option>
              <option value="rainDiverter">
                Flashing — Rain Diverter (per unit)
              </option>
            </select>

            {/* Unit price */}
            <input
              value={material.unitPrice}
              onChange={(e) =>
                setMaterial((s) => ({ ...s, unitPrice: e.target.value }))
              }
              type="number"
              min={0}
              step="0.01"
              placeholder="Unit price $"
              className="min-w-0 rounded-lg border border-[var(--color-border)] bg-white/80 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
            />

            {/* Quantity */}
            <input
              value={material.quantity}
              onChange={(e) =>
                setMaterial((s) => ({ ...s, quantity: e.target.value }))
              }
              type="number"
              min={0}
              step="1"
              placeholder="Qty"
              className="min-w-0 rounded-lg border border-[var(--color-border)] bg-white/80 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
            />

            <button className="shrink-0 w-full md:w-auto rounded-lg bg-cyan-800 hover:bg-cyan-700 transition duration-300 ease-in-out px-3 py-2 text-sm text-[var(--btn-text)]  sm:col-span-2 md:col-auto">
              Add
            </button>
          </form>

          {/* Materials list */}
          <ul className="mt-3 rounded-lg">
            {(job?.expenses?.materials ?? []).map((m) => (
              <motion.li
                key={m.id}
                className="mb-2 flex items-center justify-between rounded-lg bg-[var(--color-accent)]/2 p-3 shadow-md"
                variants={item}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-[var(--color-text)]">
                      {m.category === "coilNails" && "Coil Nails"}
                      {m.category === "tinCaps" && "Tin Caps"}
                      {m.category === "plasticJacks" && "Plastic Jacks"}
                      {m.category === "counterFlashing" && "Counter Flashing"}
                      {m.category === "jFlashing" && "J/L Flashing"}
                      {m.category === "rainDiverter" && "Rain Diverter"}
                    </span>
                    {m.vendor && (
                      <span className="ml-2 text-xs text-[var(--color-muted)]">
                        • {m.vendor}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-[var(--color-muted)]">
                    {m.quantity} × ${(m.unitPriceCents / 100).toFixed(2)}
                    {m.createdAt ? ` • ${fmtDate(m.createdAt)}` : ""}
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <CountMoney
                    cents={m.amountCents}
                    className="text-sm text-[var(--color-text)]"
                  />
                  <button
                    onClick={() => removeMaterial(m.id)}
                    className="rounded-md border border-[var(--color-border)] bg-white px-2 py-1 text-xs text-[var(--color-muted)] hover:bg-[var(--color-card-hover)]"
                    title="Delete"
                  >
                    Delete
                  </button>
                </div>
              </motion.li>
            ))}
            {(job?.expenses?.materials ?? []).length === 0 && (
              <li className="p-3 text-sm text-[var(--color-muted)]">
                No materials added yet.
              </li>
            )}
          </ul>
        </MotionCard>

        {/* Notes */}
        <MotionCard title="Notes" delay={0.2}>
          <form
            className="grid grid-cols-[1fr_auto] gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              addNote();
            }}
          >
            <input
              ref={noteRef}
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder="Add a note"
              className="rounded-lg border border-[var(--color-border)] bg-white/80 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
            />
            <button className="rounded-lg  px-4 py-2 text-sm text-[var(--btn-text)] bg-cyan-800 hover:bg-cyan-700 transition duration-300 ease-in-out">
              Add
            </button>
          </form>
          <ul className="mt-3">
            {(job?.notes ?? [])
              .slice()
              .reverse()
              .map((n) => (
                <motion.li
                  key={n.id}
                  className="mb-2 flex items-center justify-between rounded-lg bg-[var(--color-accent)]/2 p-3 shadow-md"
                  variants={item}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="font-medium text-[var(--color-text)]">
                      {n.text}
                    </span>
                    <span className="ml-2 text-xs text-[var(--color-muted)]">
                      {n.createdAt ? fmtDate(n.createdAt) : ""}
                    </span>
                  </div>
                  <button
                    onClick={() => removeNote(n.id)}
                    className="rounded-md border border-[var(--color-border)] bg-white px-2 py-1 text-xs text-[var(--color-muted)] hover:bg-[var(--color-card-hover)]"
                    title="Delete"
                  >
                    Delete
                  </button>
                </motion.li>
              ))}
            {(job?.notes ?? []).length === 0 && (
              <li className="p-3 text-sm text-[var(--color-muted)]">
                No notes yet.
              </li>
            )}
          </ul>
        </MotionCard>

        {/* Photos (JobAttachment[]) */}
        <MotionCard title="Photos" delay={0.25}>
          <form
            className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]"
            onSubmit={(e) => {
              e.preventDefault();
              addPhoto();
            }}
          >
            <input
              ref={photoRef}
              value={photoUrl}
              onChange={(e) => setPhotoUrl(e.target.value)}
              placeholder="Paste a photo URL (upload coming next)"
              className="rounded-lg border border-[var(--color-border)] bg-white/80 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
            />
            <input
              value={photoLabel}
              onChange={(e) => setPhotoLabel(e.target.value)}
              placeholder="Optional label"
              className="rounded-lg border border-[var(--color-border)] bg-white/80 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
            />
            <button className="rounded-lg  px-4 py-2 text-sm text-[var(--btn-text)] bg-cyan-800 hover:bg-cyan-700 transition duration-300 ease-in-out">
              Add
            </button>
          </form>

          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
            {(job?.attachments ?? []).map((p) => {
              const label = getAttachmentLabel(p);
              return (
                <motion.div
                  key={p.url}
                  className="group relative"
                  variants={item}
                >
                  <img
                    src={p.url}
                    alt={label}
                    className="h-32 w-full rounded-lg object-cover"
                  />
                  <button
                    onClick={() => removePhoto(p.url)}
                    className="absolute right-2 top-2 hidden rounded-full bg-black/60 px-2 py-1 text-xs text-white group-hover:block"
                  >
                    Delete
                  </button>
                  {label && (
                    <div className="absolute inset-x-0 bottom-0 rounded-b-lg bg-black/50 p-1 text-center text-[10px] text-white">
                      {label}
                    </div>
                  )}
                </motion.div>
              );
            })}
            {(job?.attachments ?? []).length === 0 && (
              <div className="p-3 text-sm text-[var(--color-muted)]">
                No photos yet.
              </div>
            )}
          </div>
        </MotionCard>
      </div>

      {/* ===== Danger zone (Archive / Permanent delete) ===== */}
      <motion.section
        className="mt-10 rounded-2xl border border-red-200 bg-red-50 p-4"
        {...fadeUp(0.27)}
      >
        <h3 className="mb-2 text-lg font-semibold text-red-800">Danger zone</h3>
        <p className="mb-4 text-sm text-red-700">
          Archiving hides this job from normal views but keeps its history.
          Permanent deletion removes it forever.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            onClick={() => setStatus("archived")}
            className="rounded-md border border-red-200 bg-white px-3 py-2 text-sm text-red-700 hover:bg-red-100"
          >
            Archive job
          </button>
          <button
            onClick={permanentlyDeleteJob}
            className="rounded-md bg-red-700 px-3 py-2 text-sm text-white hover:bg-red-600"
            title="Permanently delete this job"
          >
            Permanently delete…
          </button>
        </div>
      </motion.section>

      {/* Invoice Modal (unchanged) */}
      {invoiceModalOpen && job && (
        <InvoiceCreateModal
          job={job}
          open={invoiceModalOpen}
          onClose={() => setInvoiceModalOpen(false)}
        />
      )}
    </motion.div>
  );
}

// --- UI bits ---
function Stat({ label, cents }: { label: string; cents: number }) {
  return (
    <motion.div
      className="rounded-xl shadow-md bg-white/70 p-3"
      variants={item}
    >
      <div className="text-xs text-[var(--color-muted)]">{label}</div>
      <div className="text-lg font-semibold text-[var(--color-text)]">
        <CountMoney cents={cents} />
      </div>
    </motion.div>
  );
}

function MotionCard({
  title,
  children,
  delay = 0,
}: {
  title: string;
  children: React.ReactNode;
  delay?: number;
}) {
  return (
    <motion.section
      className="rounded-2xl shadow-md bg-white py-6 px-4"
      {...fadeUp(delay)}
    >
      <h2 className="mb-3 text-2xl font-griffon bg-cyan-700/3 p-2 font-semibold text-[var(--color-text)]">
        {title}
      </h2>
      {children}
    </motion.section>
  );
}
