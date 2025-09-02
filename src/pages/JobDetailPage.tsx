// src/pages/JobDetailPage.tsx
// NOTE: This page uses framer-motion and react-countup.
// Install:  npm i framer-motion react-countup
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  collection,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  Timestamp,
} from "firebase/firestore";
import { motion, type MotionProps } from "framer-motion";
import CountUp from "react-countup";

import { db } from "../firebase/firebaseConfig";
import type {
  Job,
  Payout,
  MaterialExpense,
  Note,
  Photo,
  JobStatus,
} from "../types/types";
import { jobConverter } from "../types/types";
import { toCents } from "../utils/money";
import { recomputeJob } from "../utils/calc";

// ---------- Animation helpers (typed) ----------
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

export default function JobDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [job, setJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [earningsInput, setEarningsInput] = useState<string>("");
  const [payout, setPayout] = useState({ payeeNickname: "", amount: "" });
  const [material, setMaterial] = useState({
    name: "",
    vendor: "",
    amount: "",
  });
  const [noteText, setNoteText] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");

  const payeeRef = useRef<HTMLInputElement | null>(null);
  const materialRef = useRef<HTMLInputElement | null>(null);
  const noteRef = useRef<HTMLInputElement | null>(null);
  const photoRef = useRef<HTMLInputElement | null>(null);

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
          setEarningsInput(
            String((data.earnings?.totalEarningsCents ?? 0) / 100)
          );
        }
      } catch (e: any) {
        if (!cancelled) setError(e.message || String(e));
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

  // Replace your entire function with this:
  async function saveJob(nextJob: Job) {
    const ref = doc(collection(db, "jobs"), nextJob.id).withConverter(
      jobConverter
    );
    const previous = job; // keep a copy to roll back on error

    try {
      // 1) Optimistic UI: show a real Date *now* so we never render "Invalid Date"
      const optimistic = recomputeJob({
        ...nextJob,
        updatedAt: Timestamp.now() as any,
      });
      setJob(optimistic);

      // 2) Persist to Firestore with canonical server time
      const toPersist = recomputeJob({
        ...nextJob,
        updatedAt: serverTimestamp() as any,
      });
      await setDoc(ref, toPersist, { merge: true });

      // 3) Read back the authoritative doc (now has a concrete Firestore Timestamp)
      const snap = await getDoc(ref);
      if (snap.exists()) {
        setJob(snap.data());
      }
    } catch (err) {
      console.error("Failed to save job", err);
      // Roll back UI if the write fails
      if (previous) setJob(previous);
    }
  }

  // ---- Status mutation ----
  async function setStatus(status: JobStatus) {
    if (!job) return;
    await saveJob({ ...job, status });
  }

  // ---- Mutations ----
  async function setEarnings() {
    if (!job) return;
    const amt = Number(earningsInput);
    if (Number.isNaN(amt) || amt < 0) return;
    const updated: Job = {
      ...job,
      earnings: {
        ...job.earnings,
        totalEarningsCents: toCents(amt),
      },
    };
    await saveJob(updated);
  }

  async function addPayout() {
    if (!job || !payout.payeeNickname || !payout.amount) return;
    const entry: Payout = {
      id: crypto.randomUUID(),
      payeeNickname: payout.payeeNickname.trim(),
      amountCents: toCents(Number(payout.amount)),
      method: "check",
      paidAt: Timestamp.now() as any, // cannot use serverTimestamp inside arrays
    };
    const updated: Job = {
      ...job,
      expenses: {
        ...job.expenses,
        payouts: [...(job.expenses.payouts ?? []), entry],
      },
    };
    await saveJob(updated);
    setPayout({ payeeNickname: "", amount: "" });
    payeeRef.current?.focus();
  }

  async function addMaterial() {
    if (!job || !material.name || !material.amount) return;
    const vendor = material.vendor?.trim();
    const entry: MaterialExpense = {
      id: crypto.randomUUID(),
      name: material.name.trim(),
      amountCents: toCents(Number(material.amount)),
      ...(vendor ? { vendor } : {}), // omit if blank
    } as MaterialExpense;

    const currentMaterials = job.expenses?.materials ?? [];
    const updated: Job = {
      ...job,
      expenses: {
        ...(job.expenses ?? {}),
        materials: [...currentMaterials, entry],
      },
    };

    await saveJob(updated);
    setMaterial({ name: "", vendor: "", amount: "" });
    materialRef.current?.focus();
  }

  async function addNote() {
    if (!job || !noteText.trim()) return;
    const entry: Note = {
      id: crypto.randomUUID(),
      text: noteText.trim(),
      createdAt: Timestamp.now() as any,
    };
    const updated: Job = { ...job, notes: [...(job.notes ?? []), entry] };
    await saveJob(updated);
    setNoteText("");
    noteRef.current?.focus();
  }

  async function addPhoto() {
    if (!job || !photoUrl.trim()) return;
    const entry: Photo = {
      id: crypto.randomUUID(),
      url: photoUrl.trim(),
      createdAt: Timestamp.now() as any,
    } as any;
    const updated: Job = {
      ...job,
      attachments: [...(job.attachments ?? []), entry],
    };
    await saveJob(updated);
    setPhotoUrl("");
    photoRef.current?.focus();
  }

  async function removePayout(id: string) {
    if (!job) return;
    const updated: Job = {
      ...job,
      expenses: {
        ...job.expenses,
        payouts: (job.expenses.payouts ?? []).filter((p) => p.id !== id),
      },
    };
    await saveJob(updated);
  }

  async function removeMaterial(id: string) {
    if (!job) return;
    const updated: Job = {
      ...job,
      expenses: {
        ...job.expenses,
        materials: (job.expenses.materials ?? []).filter((m) => m.id !== id),
      },
    };
    await saveJob(updated);
  }

  async function removeNote(id: string) {
    if (!job) return;
    const updated: Job = {
      ...job,
      notes: (job.notes ?? []).filter((n) => n.id !== id),
    };
    await saveJob(updated);
  }

  async function removePhoto(id: string) {
    if (!job) return;
    const updated: Job = {
      ...job,
      attachments: (job.attachments ?? []).filter((p: any) => p.id !== id),
    };
    await saveJob(updated);
  }

  if (loading)
    return <div className="p-8 text-[var(--color-text)]">Loading…</div>;
  if (error) return <div className="p-8 text-red-600">{error}</div>;
  if (!job) return <div className="p-8">Not found.</div>;

  const last = job.updatedAt ?? job.createdAt ?? null;
  const lastStr = last
    ? new Date(
        (last as any)?.toDate ? (last as any).toDate() : last
      ).toLocaleString()
    : "—";

  return (
    <motion.div
      className="mx-auto w-[min(1200px,94vw)] py-8"
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
          <h1 className="mt-2 text-2xl font-bold text-[var(--color-text)]">
            {job.address?.fullLine}
          </h1>
          <div className="text-sm text-[var(--color-muted)]">
            Last updated: {lastStr}
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
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

          <div className="rounded-2xl shadow-md mt-5 px-5 py-3 text-right">
            <div className="text-xs text-[var(--color-muted)]">Net Revenue</div>
            <div className="text-2xl font-semibold text-[var(--color-text)]">
              <CountMoney cents={totals.net} />
            </div>
          </div>
        </div>
      </motion.div>

      {/* Stat row + profit bar */}
      <motion.div className="rounded-2xl shadow-md  p-4" {...fadeUp(0.05)}>
        <div className="grid gap-4 sm:grid-cols-4 ">
          <Stat label="Payouts" cents={totals.payouts} />
          <Stat label="Materials" cents={totals.materials} />
          <Stat label="All Expenses" cents={totals.expenses} />
          <Stat label="Earnings" cents={totals.earnings} />
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
        {/* Earnings */}
        <MotionCard title="Earnings" delay={0.05}>
          <form
            className="grid grid-cols-[1fr_auto] gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setEarnings();
            }}
          >
            <input
              value={earningsInput}
              onChange={(e) => setEarningsInput(e.target.value)}
              inputMode="decimal"
              type="number"
              min={0}
              step="0.01"
              placeholder="Total earnings for this job"
              className="rounded-lg border border-[var(--color-border)] bg-white/80 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
            />
            <button className="rounded-lg bg-[var(--color-text)] px-4 py-2 text-sm text-[var(--btn-text)] hover:bg-[var(--btn-hover-bg)]">
              Save
            </button>
          </form>
          <p className="mt-2 text-xs text-[var(--color-muted)]">
            Set the total job revenue invoiced to the client.
          </p>
        </MotionCard>

        {/* Payouts */}
        <MotionCard title="Payouts" delay={0.1}>
          <form
            className="grid gap-2 sm:grid-cols-[1fr_140px_90px]"
            onSubmit={(e) => {
              e.preventDefault();
              addPayout();
            }}
          >
            <input
              ref={payeeRef}
              value={payout.payeeNickname}
              onChange={(e) =>
                setPayout((s) => ({ ...s, payeeNickname: e.target.value }))
              }
              placeholder="Payee nickname"
              className="rounded-lg border border-[var(--color-border)] bg-white/80 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
            />
            <input
              value={payout.amount}
              onChange={(e) =>
                setPayout((s) => ({ ...s, amount: e.target.value }))
              }
              type="number"
              min={0}
              step="0.01"
              placeholder="Amount"
              className="rounded-lg border border-[var(--color-border)] bg-white/80 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
            />
            <button className="rounded-lg bg-[var(--color-text)] px-3 py-2 text-sm text-[var(--btn-text)] hover:bg-[var(--btn-hover-bg)]">
              Add
            </button>
          </form>

          <ul className="mt-3  rounded-lg  bg-white/70">
            {(job?.expenses?.payouts ?? []).map((p) => (
              <motion.li
                key={p.id}
                className="flex items-center justify-between p-3 shadow-md rounded-lg bg-[var(--color-accent)]/2 mb-2"
                variants={item}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span className="font-medium text-[var(--color-text)]">
                    {p.payeeNickname}
                  </span>
                  <span className="ml-2 text-xs text-[var(--color-muted)]">
                    {p.paidAt
                      ? new Date(
                          (p.paidAt as any).toDate?.() ?? p.paidAt
                        ).toLocaleDateString()
                      : ""}
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
            className="grid items-start gap-2 max-w-full md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_140px_auto] sm:grid-cols-2"
          >
            <input
              ref={materialRef}
              value={material.name}
              onChange={(e) =>
                setMaterial((s) => ({ ...s, name: e.target.value }))
              }
              placeholder="Material name"
              className="min-w-0 rounded-lg border border-[var(--color-border)] bg-white/80 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
            />
            <input
              value={material.vendor}
              onChange={(e) =>
                setMaterial((s) => ({ ...s, vendor: e.target.value }))
              }
              placeholder="Vendor (optional)"
              className="min-w-0 rounded-lg border border-[var(--color-border)] bg-white/80 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
            />
            <input
              value={material.amount}
              onChange={(e) =>
                setMaterial((s) => ({ ...s, amount: e.target.value }))
              }
              type="number"
              min={0}
              step="0.01"
              placeholder="Amount"
              className="min-w-0 rounded-lg border border-[var(--color-border)] bg-white/80 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--color-accent)] sm:col-span-2 md:col-span-1"
            />
            <button className="shrink-0 w-full md:w-auto rounded-lg bg-[var(--color-text)] px-3 py-2 text-sm text-[var(--btn-text)] hover:bg-[var(--btn-hover-bg)] sm:col-span-2 md:col-auto">
              Add
            </button>
          </form>

          {/* Materials list */}
          <ul className="mt-3  rounded-lg ">
            {(job?.expenses?.materials ?? []).map((m) => (
              <motion.li
                key={m.id}
                className="flex items-center justify-between p-3 shadow-md rounded-lg mb-2 bg-[var(--color-accent)]/2"
                variants={item}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span className="font-medium text-[var(--color-text)]">
                    {m.name}
                  </span>
                  {m.vendor && (
                    <span className="ml-2 text-xs text-[var(--color-muted)]">
                      • {m.vendor}
                    </span>
                  )}
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
            <button className="rounded-lg bg-[var(--color-text)] px-4 py-2 text-sm text-[var(--btn-text)] hover:bg-[var(--btn-hover-bg)]">
              Add
            </button>
          </form>
          <ul className="mt-3 ">
            {(job?.notes ?? [])
              .slice()
              .reverse()
              .map((n) => (
                <motion.li
                  key={n.id}
                  className="flex items-center justify-between p-3  shadow-md rounded-lg mb-2 bg-[var(--color-accent)]/2"
                  variants={item}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="font-medium text-[var(--color-text)]">
                      {n.text}
                    </span>
                    <span className="ml-2 text-xs text-[var(--color-muted)]">
                      {n.createdAt
                        ? new Date(
                            // supports Firestore Timestamp or plain Date/string
                            (n.createdAt as any).toDate?.() ?? n.createdAt
                          ).toLocaleDateString()
                        : ""}
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

        {/* Photos */}
        <MotionCard title="Photos" delay={0.25}>
          <form
            className="grid grid-cols-[1fr_auto] gap-2"
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
            <button className="rounded-lg bg-[var(--color-text)] px-4 py-2 text-sm text-[var(--btn-text)] hover:bg-[var(--btn-hover-bg)]">
              Add
            </button>
          </form>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
            {(job?.attachments ?? []).map((p: any) => (
              <motion.div key={p.id} className="group relative" variants={item}>
                <img
                  src={p.url}
                  alt={p.caption ?? ""}
                  className="h-32 w-full rounded-lg object-cover"
                />
                <button
                  onClick={() => removePhoto(p.id)}
                  className="absolute right-2 top-2 hidden rounded-full bg-black/60 px-2 py-1 text-xs text-white group-hover:block"
                >
                  Delete
                </button>
              </motion.div>
            ))}
            {(job?.attachments ?? []).length === 0 && (
              <div className="p-3 text-sm text-[var(--color-muted)]">
                No photos yet.
              </div>
            )}
          </div>
        </MotionCard>
      </div>
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
      className="rounded-2xl shadow-md bg-[var(--color-card)] p-4"
      {...fadeUp(delay)}
    >
      <h2 className="mb-3 text-lg font-semibold text-[var(--color-text)]">
        {title}
      </h2>
      {children}
    </motion.section>
  );
}
