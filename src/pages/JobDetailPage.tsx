// src/pages/JobDetailPage.tsx
import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import {
  collection,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { db } from "../firebase/firebaseConfig";
import type { Job, Payout, MaterialExpense, Note, Photo } from "../types/types";
import { jobConverter } from "../types/types";
import { formatCurrency, toCents } from "../utils/money";
import { recomputeJob } from "../utils/calc";

export default function JobDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [job, setJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // form state
  const [payout, setPayout] = useState({ payeeNickname: "", amount: "" });
  const [material, setMaterial] = useState({
    name: "",
    vendor: "",
    amount: "",
  });
  const [noteText, setNoteText] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function run() {
      try {
        const ref = doc(collection(db, "jobs"), id as string).withConverter(
          jobConverter
        );
        const snap = await getDoc(ref);
        if (!snap.exists()) throw new Error("Job not found");
        if (!cancelled) setJob(snap.data());
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

  const totals = useMemo(
    () => ({
      earnings: job?.earnings?.totalEarningsCents ?? 0,
      payouts: job?.expenses?.totalPayoutsCents ?? 0,
      materials: job?.expenses?.totalMaterialsCents ?? 0,
      expenses: job?.computed?.totalExpensesCents ?? 0,
      net: job?.computed?.netProfitCents ?? 0,
    }),
    [job]
  );

  async function saveJob(updated: Job) {
    const ref = doc(collection(db, "jobs"), updated.id).withConverter(
      jobConverter
    );
    const next = recomputeJob({
      ...updated,
      updatedAt: serverTimestamp() as any,
    });
    await setDoc(ref, next, { merge: true });
    setJob(next);
  }

  async function addPayout() {
    if (!job) return;
    if (!payout.payeeNickname || !payout.amount) return;
    const entry: Payout = {
      id: crypto.randomUUID(),
      payeeNickname: payout.payeeNickname.trim(),
      amountCents: toCents(Number(payout.amount)),
      paidAt: serverTimestamp() as any,
      method: "check",
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
  }

  async function addMaterial() {
    if (!job) return;
    if (!material.name || !material.amount) return;
    const entry: MaterialExpense = {
      id: crypto.randomUUID(),
      name: material.name.trim(),
      vendor: material.vendor?.trim() || undefined,
      amountCents: toCents(Number(material.amount)),
    };
    const updated: Job = {
      ...job,
      expenses: {
        ...job.expenses,
        materials: [...(job.expenses.materials ?? []), entry],
      },
    };
    await saveJob(updated);
    setMaterial({ name: "", vendor: "", amount: "" });
  }

  async function addNote() {
    if (!job) return;
    if (!noteText.trim()) return;
    const entry: Note = {
      id: crypto.randomUUID(),
      text: noteText.trim(),
      createdAt: serverTimestamp() as any,
    };
    const updated: Job = {
      ...job,
      notes: [...(job.notes ?? []), entry],
    };
    await saveJob(updated);
    setNoteText("");
  }

  async function addPhoto() {
    if (!job) return;
    if (!photoUrl.trim()) return;
    const entry: Photo = {
      id: crypto.randomUUID(),
      url: photoUrl.trim(),
      createdAt: serverTimestamp() as any,
    } as any;
    const updated: Job = {
      ...job,
      attachments: [...(job.attachments ?? []), entry],
    };
    await saveJob(updated);
    setPhotoUrl("");
  }

  if (loading)
    return <div className="p-8 text-[var(--color-text)]">Loading...</div>;
  if (error) return <div className="p-8 text-red-600">{error}</div>;
  if (!job) return <div className="p-8">Not found.</div>;

  const last = job.updatedAt ?? job.createdAt ?? null;

  return (
    <div className="mx-auto w-[min(1100px,92vw)] py-10">
      <div className="mb-6 flex items-center justify-between">
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
            Last updated:{" "}
            {last
              ? new Date(
                  (last as any)?.toDate ? (last as any).toDate() : last
                ).toLocaleString()
              : "—"}
          </div>
        </div>
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] px-4 py-2 text-right">
          <div className="text-xs text-[var(--color-muted)]">Net Profit</div>
          <div className="text-xl font-bold text-[var(--color-text)]">
            {formatCurrency(totals.net)}
          </div>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-4">
        <SummaryCard label="Earnings" value={formatCurrency(totals.earnings)} />
        <SummaryCard label="Payouts" value={formatCurrency(totals.payouts)} />
        <SummaryCard
          label="Materials"
          value={formatCurrency(totals.materials)}
        />
        <SummaryCard label="Expenses" value={formatCurrency(totals.expenses)} />
      </div>

      {/* Add line items */}
      <section className="mt-8 grid gap-6 sm:grid-cols-2">
        {/* Payouts */}
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4">
          <h2 className="mb-3 text-lg font-semibold text-[var(--color-text)]">
            Add Payout
          </h2>
          <div className="grid gap-3 sm:grid-cols-[1fr,120px,120px]">
            <input
              value={payout.payeeNickname}
              onChange={(e) =>
                setPayout((s) => ({ ...s, payeeNickname: e.target.value }))
              }
              placeholder="Payee nickname"
              className="rounded-lg border border-[var(--color-border)] bg-white/70 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
            />
            <input
              value={payout.amount}
              onChange={(e) =>
                setPayout((s) => ({ ...s, amount: e.target.value }))
              }
              placeholder="Amount"
              type="number"
              min={0}
              className="rounded-lg border border-[var(--color-border)] bg-white/70 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
            />
            <button
              onClick={addPayout}
              className="rounded-lg bg-[var(--btn-bg)] text-[var(--btn-text)] px-3 py-2 text-sm hover:bg-[var(--btn-hover-bg)]"
            >
              Add
            </button>
          </div>

          <ul className="mt-4 space-y-2 text-sm">
            {(job.expenses.payouts ?? []).map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between rounded-lg border border-[var(--color-border)] bg-white/70 px-3 py-2"
              >
                <span className="text-[var(--color-text)]">
                  {p.payeeNickname}
                </span>
                <span className="text-[var(--color-muted)]">
                  {formatCurrency(p.amountCents)}
                </span>
              </li>
            ))}
          </ul>
        </div>

        {/* Materials */}
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4">
          <h2 className="mb-3 text-lg font-semibold text-[var(--color-text)]">
            Add Material
          </h2>
          <div className="grid gap-3 sm:grid-cols-[1fr,1fr,120px]">
            <input
              value={material.name}
              onChange={(e) =>
                setMaterial((s) => ({ ...s, name: e.target.value }))
              }
              placeholder="Material name"
              className="rounded-lg border border-[var(--color-border)] bg-white/70 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
            />
            <input
              value={material.vendor}
              onChange={(e) =>
                setMaterial((s) => ({ ...s, vendor: e.target.value }))
              }
              placeholder="Vendor (optional)"
              className="rounded-lg border border-[var(--color-border)] bg-white/70 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
            />
            <div className="grid grid-cols-[1fr,auto] gap-2">
              <input
                value={material.amount}
                onChange={(e) =>
                  setMaterial((s) => ({ ...s, amount: e.target.value }))
                }
                placeholder="Amount"
                type="number"
                min={0}
                className="rounded-lg border border-[var(--color-border)] bg-white/70 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
              />
              <button
                onClick={addMaterial}
                className="rounded-lg bg-[var(--btn-bg)] text-[var(--btn-text)] px-3 py-2 text-sm hover:bg-[var(--btn-hover-bg)]"
              >
                Add
              </button>
            </div>
          </div>

          <ul className="mt-4 space-y-2 text-sm">
            {(job.expenses.materials ?? []).map((m) => (
              <li
                key={m.id}
                className="flex items-center justify-between rounded-lg border border-[var(--color-border)] bg-white/70 px-3 py-2"
              >
                <span className="text-[var(--color-text)]">{m.name}</span>
                <span className="text-[var(--color-muted)]">
                  {formatCurrency(m.amountCents)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Notes & Photos */}
      <section className="mt-8 grid gap-6 sm:grid-cols-2">
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4">
          <h2 className="mb-3 text-lg font-semibold text-[var(--color-text)]">
            Notes
          </h2>
          <div className="flex gap-2">
            <input
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder="Add a note"
              className="flex-1 rounded-lg border border-[var(--color-border)] bg-white/70 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
            />
            <button
              onClick={addNote}
              className="rounded-lg bg-[var(--btn-bg)] text-[var(--btn-text)] px-3 py-2 text-sm hover:bg-[var(--btn-hover-bg)]"
            >
              Add
            </button>
          </div>
          <ul className="mt-4 space-y-2 text-sm">
            {(job.notes ?? [])
              .slice()
              .reverse()
              .map((n) => (
                <li
                  key={n.id}
                  className="rounded-lg border border-[var(--color-border)] bg-white/70 px-3 py-2"
                >
                  {n.text}
                </li>
              ))}
          </ul>
        </div>

        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4">
          <h2 className="mb-3 text-lg font-semibold text-[var(--color-text)]">
            Photos
          </h2>
          <div className="flex gap-2">
            <input
              value={photoUrl}
              onChange={(e) => setPhotoUrl(e.target.value)}
              placeholder="Paste a photo URL (upload coming next)"
              className="flex-1 rounded-lg border border-[var(--color-border)] bg-white/70 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
            />
            <button
              onClick={addPhoto}
              className="rounded-lg bg-[var(--btn-bg)] text-[var(--btn-text)] px-3 py-2 text-sm hover:bg-[var(--btn-hover-bg)]"
            >
              Add
            </button>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {(job.attachments ?? []).map((p: any) => (
              <img
                key={p.id}
                src={p.url}
                alt={p.caption ?? ""}
                className="h-28 w-full rounded-lg object-cover"
              />
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4">
      <div className="text-sm text-[var(--color-muted)]">{label}</div>
      <div className="text-xl font-bold text-[var(--color-text)]">{value}</div>
    </div>
  );
}
