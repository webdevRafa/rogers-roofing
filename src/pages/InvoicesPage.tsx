// src/pages/InvoicesPage.tsx
// Invoice management for Roger's Roofing (org-scoped, job-linked).
// - Create invoice from a job (labor/materials derived + extras)
// - Save draft or Save & Send (status=sent)
// - Print / Save PDF from preview modal
// - Mark paid

import { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  onSnapshot,
  query,
  orderBy,
  where,
  setDoc,
  updateDoc,
  serverTimestamp,
  getDocs,
} from "firebase/firestore";
import type { FieldValue } from "firebase/firestore";

import { useOrg } from "../contexts/OrgContext";
import { db } from "../firebase/firebaseConfig";
import type {
  InvoiceDoc,
  Job,
  InvoiceLine,
  InvoiceStatus,
} from "../types/types";
import { jobConverter } from "../types/types";

import { X, FileText, CheckCircle, Plus, Printer } from "lucide-react";
import { createPortal } from "react-dom";

// ---------------- helpers ----------------

function money(cents: number | null | undefined): string {
  const v = typeof cents === "number" ? cents : 0;
  return (v / 100).toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

/** Remove undefined keys (shallow). Firestore rejects undefined values. */
function compact<T extends Record<string, any>>(obj: T): Partial<T> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out as Partial<T>;
}

/** compact() but return undefined if result is empty */
function compactOrUndef<T extends Record<string, any>>(
  obj: T
): Partial<T> | undefined {
  const c = compact(obj);
  return Object.keys(c).length ? c : undefined;
}

/** Normalize Job["address"] into invoice snapshot WITHOUT undefined keys. */
function buildAddressSnapshot(
  job: Job
): InvoiceDoc["addressSnapshot"] | undefined {
  const a: any = (job as any)?.address;
  if (!a) return undefined;

  // If address is just a string, keep it simple.
  if (typeof a === "string") {
    const full = a.trim();
    if (!full) return undefined;
    return { fullLine: full, line1: full };
  }

  // Object-ish address (supports several field names seen in your app)
  const fullLine =
    (typeof a.fullLine === "string" && a.fullLine.trim()) ||
    (typeof a.full === "string" && a.full.trim()) ||
    (typeof a.formatted === "string" && a.formatted.trim()) ||
    (typeof a.label === "string" && a.label.trim()) ||
    (typeof a.text === "string" && a.text.trim()) ||
    undefined;

  const line1 =
    (typeof a.line1 === "string" && a.line1.trim()) ||
    (typeof a.street === "string" && a.street.trim()) ||
    (typeof a.address === "string" && a.address.trim()) ||
    (typeof a.address1 === "string" && a.address1.trim()) ||
    (typeof a.street1 === "string" && a.street1.trim()) ||
    // fallback: if we have a fullLine, we can still populate line1 safely
    fullLine ||
    undefined;

  const city =
    (typeof a.city === "string" && a.city.trim()) ||
    (typeof a.town === "string" && a.town.trim()) ||
    undefined;

  const state =
    (typeof a.state === "string" && a.state.trim()) ||
    (typeof a.region === "string" && a.region.trim()) ||
    (typeof a.province === "string" && a.province.trim()) ||
    undefined;

  const zip =
    (typeof a.postalCode === "string" && a.postalCode.trim()) ||
    (typeof a.zip === "string" && a.zip.trim()) ||
    (typeof a.zipCode === "string" && a.zipCode.trim()) ||
    (typeof a.postcode === "string" && a.postcode.trim()) ||
    undefined;

  return compactOrUndef({ fullLine, line1, city, state, zip });
}

// Generate a human friendly invoice number like INV-2025-000123
async function generateInvoiceNumber(orgId: string): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `INV-${year}-`;

  try {
    const q = query(
      collection(db, "invoices"),
      where("orgId", "==", orgId),
      where("number", ">=", prefix),
      where("number", "<=", prefix + "\uffff"),
      orderBy("number", "desc"),
      orderBy("createdAt", "desc")
    );

    const snap = await getDocs(q);
    let maxSeq = 0;

    snap.forEach((d) => {
      const num = (d.data() as InvoiceDoc).number;
      const parts = String(num).split("-");
      const seqStr = parts[2];
      const seq = Number(seqStr);
      if (Number.isFinite(seq) && seq > maxSeq) maxSeq = seq;
    });

    const nextSeq = (maxSeq + 1).toString().padStart(6, "0");
    return `${prefix}${nextSeq}`;
  } catch {
    const ts = Date.now().toString().slice(-6);
    return `${prefix}${ts}`;
  }
}

// ---------------- tiny toast ----------------

function Toast({
  message,
  kind,
  onClose,
}: {
  message: string;
  kind: "success" | "error" | "info";
  onClose: () => void;
}) {
  const tone =
    kind === "success"
      ? "bg-emerald-900/90 border-emerald-200/30"
      : kind === "error"
      ? "bg-rose-900/90 border-rose-200/30"
      : "bg-black/80 border-white/10";

  return (
    <div className="fixed bottom-5 right-5 z-[80] w-[min(420px,92vw)]">
      <div
        className={cx(
          "rounded-2xl border px-4 py-3 shadow-xl text-white",
          tone
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="text-sm leading-snug">{message}</div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-white/80 hover:text-white hover:bg-white/10"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------- Create Invoice Modal ----------------

function NewInvoiceModal({
  orgId,
  jobs,
  onClose,
  onCreated,
}: {
  orgId: string;
  jobs: Job[];
  onClose: () => void;
  onCreated?: (invoice: InvoiceDoc) => void;
}) {
  if (typeof document === "undefined") return null;

  const [jobId, setJobId] = useState<string>(jobs[0]?.id ?? "");
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [description, setDescription] = useState("");
  const [extras, setExtras] = useState<
    Array<{ label: string; amount: string }>
  >([]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const selectedJob = useMemo(
    () => jobs.find((j) => j.id === jobId) ?? null,
    [jobs, jobId]
  );

  const laborCents = selectedJob?.expenses?.totalPayoutsCents ?? 0;
  const materialsCents = selectedJob?.expenses?.totalMaterialsCents ?? 0;

  const extraCents = useMemo(() => {
    return extras.reduce((sum, ex) => {
      const amt = Number(ex.amount);
      if (Number.isFinite(amt) && amt > 0) return sum + Math.round(amt * 100);
      return sum;
    }, 0);
  }, [extras]);

  const subtotalCents = laborCents + materialsCents + extraCents;
  const taxCents = 0;
  const totalCents = subtotalCents + taxCents;

  function addExtra() {
    setExtras((prev) => [...prev, { label: "", amount: "" }]);
  }
  function removeExtra(idx: number) {
    setExtras((prev) => prev.filter((_, i) => i !== idx));
  }

  async function submit(nextStatus: InvoiceStatus) {
    setFormError(null);

    if (!selectedJob) {
      setFormError("Please select a job to invoice.");
      return;
    }

    // Build invoice lines: labor, materials, extras
    const lines: InvoiceLine[] = [];
    if (laborCents > 0)
      lines.push({
        id: "labor",
        label: "Labor (payouts)",
        amountCents: laborCents,
      });
    if (materialsCents > 0)
      lines.push({
        id: "materials",
        label: "Materials",
        amountCents: materialsCents,
      });

    extras.forEach((ex, idx) => {
      const amt = Number(ex.amount);
      if (ex.label.trim() && Number.isFinite(amt) && amt > 0) {
        lines.push({
          id: `extra-${idx}`,
          label: ex.label.trim(),
          amountCents: Math.round(amt * 100),
        });
      }
    });

    if (lines.length === 0) {
      setFormError("At least one line item is required.");
      return;
    }

    setSaving(true);
    try {
      const number = await generateInvoiceNumber(orgId);
      const docRef = doc(collection(db, "invoices"));

      const customer = compactOrUndef({
        name: customerName.trim() || undefined,
        email: customerEmail.trim() || undefined,
        phone: customerPhone.trim() || undefined,
      });

      const addressSnapshot = buildAddressSnapshot(selectedJob);

      const invoice: InvoiceDoc = {
        id: docRef.id,
        orgId,
        kind: "invoice",
        jobId: selectedJob.id,
        number,
        customer,
        addressSnapshot,
        description: description.trim() || undefined,
        lines,
        money: {
          materialsCents,
          laborCents,
          extraCents,
          subtotalCents,
          taxCents,
          totalCents,
        },
        createdAt: serverTimestamp() as unknown as FieldValue,
        updatedAt: serverTimestamp() as unknown as FieldValue,
        status: nextStatus,
        // note: omit paymentNote entirely unless you actually have one
      };

      // IMPORTANT: no undefined values inside invoice now
      await setDoc(docRef, invoice);
      onCreated?.(invoice);
      onClose();
    } catch (e: any) {
      setFormError(e?.message ?? String(e));
    } finally {
      setSaving(false);
    }
  }

  // Close on Escape
  useEffect(() => {
    const handler = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const content = (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-black/40 p-4">
      <div className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl border border-black/5">
        <div className="flex items-start justify-between p-5 border-b border-black/5">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 grid h-10 w-10 place-items-center rounded-xl bg-rose-50 text-rose-700">
              <FileText className="h-5 w-5" />
            </div>
            <div>
              <div className="text-lg font-semibold text-[var(--color-text)]">
                Create invoice
              </div>
              <div className="text-xs text-[var(--color-muted)]">
                Generate an invoice from a job
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[var(--color-border)] bg-white px-2 py-2 text-[var(--color-muted)] hover:bg-[var(--color-card-hover)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5">
          {formError && (
            <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {formError}
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="text-xs uppercase tracking-wide text-[var(--color-muted)]">
                Job
              </label>
              <select
                value={jobId}
                onChange={(e) => setJobId(e.target.value)}
                className="mt-1 w-full rounded-xl border border-[var(--color-border)] bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
              >
                {jobs.map((j) => (
                  <option key={j.id} value={j.id}>
                    {typeof (j as any).address === "string"
                      ? (j as any).address
                      : (j as any)?.address?.fullLine || j.id}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs uppercase tracking-wide text-[var(--color-muted)]">
                Customer name
              </label>
              <input
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                className="mt-1 w-full rounded-xl border border-[var(--color-border)] bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                placeholder="Homeowner / Property manager"
              />
            </div>

            <div>
              <label className="text-xs uppercase tracking-wide text-[var(--color-muted)]">
                Customer email
              </label>
              <input
                value={customerEmail}
                onChange={(e) => setCustomerEmail(e.target.value)}
                className="mt-1 w-full rounded-xl border border-[var(--color-border)] bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                placeholder="email@example.com"
              />
            </div>

            <div>
              <label className="text-xs uppercase tracking-wide text-[var(--color-muted)]">
                Customer phone
              </label>
              <input
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                className="mt-1 w-full rounded-xl border border-[var(--color-border)] bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                placeholder="(210) 555-1234"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="text-xs uppercase tracking-wide text-[var(--color-muted)]">
                Description
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="mt-1 min-h-[90px] w-full rounded-xl border border-[var(--color-border)] bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                placeholder="Work performed (e.g., tear-off and install, drip edge, ridge vent, underlayment, cleanup, etc.)"
              />
            </div>
          </div>

          <div className="mt-5 rounded-2xl border border-[var(--color-border)] bg-white p-4">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-[var(--color-text)]">
                Line items
              </div>
              <button
                type="button"
                onClick={addExtra}
                className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50"
              >
                <Plus className="h-4 w-4" /> Add extra
              </button>
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-black/5 bg-[var(--color-card)]/40 p-3">
                <div className="text-xs text-[var(--color-muted)]">Labor</div>
                <div className="mt-1 text-base font-semibold text-[var(--color-text)]">
                  {money(laborCents)}
                </div>
              </div>
              <div className="rounded-xl border border-black/5 bg-[var(--color-card)]/40 p-3">
                <div className="text-xs text-[var(--color-muted)]">
                  Materials
                </div>
                <div className="mt-1 text-base font-semibold text-[var(--color-text)]">
                  {money(materialsCents)}
                </div>
              </div>
            </div>

            {extras.length > 0 ? (
              <div className="mt-4 space-y-3">
                {extras.map((ex, idx) => (
                  <div
                    key={idx}
                    className="grid gap-2 sm:grid-cols-[1fr_160px_auto] items-end"
                  >
                    <div>
                      <label className="text-xs text-[var(--color-muted)]">
                        Label
                      </label>
                      <input
                        value={ex.label}
                        onChange={(e) => {
                          const v = e.target.value;
                          setExtras((prev) =>
                            prev.map((p, i) =>
                              i === idx ? { ...p, label: v } : p
                            )
                          );
                        }}
                        className="mt-1 w-full rounded-xl border border-[var(--color-border)] bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                        placeholder='e.g., "Dumpster", "Permit", "Skylight flashing"'
                      />
                    </div>
                    <div>
                      <label className="text-xs text-[var(--color-muted)]">
                        Amount ($)
                      </label>
                      <input
                        inputMode="decimal"
                        value={ex.amount}
                        onChange={(e) => {
                          const v = e.target.value;
                          setExtras((prev) =>
                            prev.map((p, i) =>
                              i === idx ? { ...p, amount: v } : p
                            )
                          );
                        }}
                        className="mt-1 w-full rounded-xl border border-[var(--color-border)] bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                        placeholder="0.00"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => removeExtra(idx)}
                      className="rounded-xl border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-muted)] hover:bg-[var(--color-card-hover)]"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-4 text-sm text-[var(--color-muted)]">
                No extras added
              </div>
            )}

            <div className="mt-4 rounded-xl border border-black/5 bg-white p-4">
              <div className="flex justify-between gap-4">
                <span className="text-sm text-[var(--color-muted)]">
                  Subtotal
                </span>
                <span className="text-sm font-semibold text-[var(--color-text)]">
                  {money(subtotalCents)}
                </span>
              </div>
              <div className="mt-2 flex justify-between gap-4">
                <span className="text-sm text-[var(--color-muted)]">Tax</span>
                <span className="text-sm font-semibold text-[var(--color-text)]">
                  {money(taxCents)}
                </span>
              </div>
              <div className="mt-2 flex justify-between gap-4 border-t border-black/5 pt-2">
                <span className="text-sm text-[var(--color-muted)]">Total</span>
                <span className="text-base font-bold text-[var(--color-text)]">
                  {money(totalCents)}
                </span>
              </div>
            </div>
          </div>

          <div className="mt-5 flex items-center justify-between">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-[var(--color-border)] bg-white px-4 py-2 text-sm font-semibold text-[var(--color-text)] hover:bg-[var(--color-card-hover)]"
              disabled={saving}
            >
              Cancel
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => submit("draft")}
                disabled={saving}
                className="rounded-xl bg-gray-100 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-200 disabled:opacity-60"
              >
                {saving ? "Saving…" : "Save draft"}
              </button>
              <button
                type="button"
                onClick={() => submit("sent")}
                disabled={saving}
                className="rounded-xl bg-emerald-800 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
              >
                {saving ? "Sending…" : "Save & Send"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(content, document.body);
}

// ---------------- Invoice Preview Modal ----------------

function InvoicePreviewModal({
  invoice,
  job,
  onClose,
  onMarkPaid,
  saving,
}: {
  invoice: InvoiceDoc;
  job: Job | null;
  onClose: () => void;
  onMarkPaid: () => void;
  saving: boolean;
}) {
  if (typeof document === "undefined") return null;

  const subtotal = invoice.money?.subtotalCents ?? 0;
  const tax = invoice.money?.taxCents ?? 0;
  const total = invoice.money?.totalCents ?? 0;

  const content = (
    <div className="fixed inset-0 z-[75] grid place-items-center bg-black/40 p-4">
      <div className="w-full max-w-3xl overflow-hidden rounded-2xl bg-white shadow-2xl border border-black/5">
        <div className="flex items-start justify-between p-5 border-b border-black/5 print:hidden">
          <div>
            <div className="text-xs uppercase tracking-wide text-[var(--color-muted)]">
              Invoice
            </div>
            <div className="text-lg font-semibold text-[var(--color-text)]">
              #{invoice.number}
            </div>
            <div className="mt-1 text-xs text-[var(--color-muted)]">
              Job:{" "}
              {invoice.addressSnapshot?.fullLine ||
                (job as any)?.address?.fullLine ||
                "—"}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[var(--color-border)] bg-white px-2 py-2 text-[var(--color-muted)] hover:bg-[var(--color-card-hover)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-6">
          {/* Header */}
          <div className="flex items-start justify-between gap-6">
            <div>
              <div className="text-sm font-semibold text-[var(--color-text)]">
                Roger’s Roofing
              </div>
              <div className="mt-1 text-xs text-[var(--color-muted)]">
                {/* You can wire org profile here later */}
                Roofing & Contracting
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs text-[var(--color-muted)]">Status</div>
              <div className="text-sm font-semibold text-[var(--color-text)]">
                {invoice.status}
              </div>
            </div>
          </div>

          {/* Bill To */}
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl border border-black/5 bg-[var(--color-card)]/40 p-4">
              <div className="text-xs uppercase tracking-wide text-[var(--color-muted)]">
                Bill To
              </div>
              <div className="mt-2 text-sm font-semibold text-[var(--color-text)]">
                {invoice.customer?.name || "—"}
              </div>
              <div className="mt-1 text-xs text-[var(--color-muted)]">
                {invoice.customer?.email || ""}
              </div>
              <div className="mt-1 text-xs text-[var(--color-muted)]">
                {invoice.customer?.phone || ""}
              </div>
            </div>

            <div className="rounded-2xl border border-black/5 bg-[var(--color-card)]/40 p-4">
              <div className="text-xs uppercase tracking-wide text-[var(--color-muted)]">
                Job Address
              </div>
              <div className="mt-2 text-sm font-semibold text-[var(--color-text)]">
                {invoice.addressSnapshot?.fullLine || "—"}
              </div>
              <div className="mt-1 text-xs text-[var(--color-muted)]">
                {[
                  invoice.addressSnapshot?.city,
                  invoice.addressSnapshot?.state,
                  invoice.addressSnapshot?.zip,
                ]
                  .filter(Boolean)
                  .join(", ")}
              </div>
            </div>
          </div>

          {invoice.description && (
            <div className="mt-6 rounded-2xl border border-black/5 bg-white p-4">
              <div className="text-xs uppercase tracking-wide text-[var(--color-muted)]">
                Description
              </div>
              <div className="mt-2 text-sm text-[var(--color-text)]">
                {invoice.description}
              </div>
            </div>
          )}

          {/* Line items */}
          <div className="mt-6 overflow-hidden rounded-2xl border border-black/5">
            <div className="grid grid-cols-[1fr_160px] bg-[var(--color-card)]/50 px-4 py-3 text-xs font-semibold text-[var(--color-muted)]">
              <div>Item</div>
              <div className="text-right">Amount</div>
            </div>
            <div className="divide-y divide-black/5">
              {invoice.lines.map((l) => (
                <div
                  key={l.id}
                  className="grid grid-cols-[1fr_160px] px-4 py-3 text-sm"
                >
                  <div className="text-[var(--color-text)]">{l.label}</div>
                  <div className="text-right font-semibold text-[var(--color-text)]">
                    {money(l.amountCents)}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Totals */}
          <div className="mt-6 flex justify-end">
            <div className="w-full max-w-sm rounded-2xl border border-black/5 bg-white p-4">
              <div className="flex justify-between gap-4">
                <span className="text-sm text-[var(--color-muted)]">
                  Subtotal
                </span>
                <span className="text-sm font-semibold text-[var(--color-text)]">
                  {money(subtotal)}
                </span>
              </div>
              <div className="mt-2 flex justify-between gap-4">
                <span className="text-sm text-[var(--color-muted)]">Tax</span>
                <span className="text-sm font-semibold text-[var(--color-text)]">
                  {money(tax)}
                </span>
              </div>
              <div className="mt-2 flex justify-between gap-4 border-t border-black/5 pt-2">
                <span className="text-sm text-[var(--color-muted)]">Total</span>
                <span className="text-base font-bold text-[var(--color-text)]">
                  {money(total)}
                </span>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="mt-6 flex flex-wrap items-center gap-2 print:hidden">
            <button
              type="button"
              onClick={() => window.print()}
              className="rounded-xl border border-[var(--color-border)] bg-white px-4 py-2 text-sm font-semibold text-[var(--color-text)] hover:bg-[var(--color-card-hover)]"
            >
              <Printer className="inline-block h-4 w-4 mr-2" />
              Print / Save PDF
            </button>

            {invoice.status !== "paid" ? (
              <button
                type="button"
                onClick={onMarkPaid}
                disabled={saving}
                className="rounded-xl bg-emerald-800 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
              >
                {saving ? "Marking…" : "Mark as paid"}
              </button>
            ) : (
              <span className="inline-flex items-center gap-2 rounded-xl bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700 border border-emerald-200/50">
                <CheckCircle className="h-4 w-4" /> Paid
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(content, document.body);
}

// ---------------- Main Page ----------------

export default function InvoicesPage() {
  const { orgId, loading: orgLoading } = useOrg();

  const [invoices, setInvoices] = useState<InvoiceDoc[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | InvoiceStatus>(
    "all"
  );

  const [openForm, setOpenForm] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<InvoiceDoc | null>(
    null
  );
  const [markingPaid, setMarkingPaid] = useState(false);

  const [toast, setToast] = useState<{
    msg: string;
    kind: "success" | "error" | "info";
  } | null>(null);

  // Subscribe to invoices (org scoped)
  useEffect(() => {
    if (!orgId) return;

    const q = query(
      collection(db, "invoices"),
      where("orgId", "==", orgId),
      orderBy("createdAt", "desc")
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: InvoiceDoc[] = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<InvoiceDoc, "id">),
        }));
        setInvoices(list);
      },
      (err) => {
        setToast({
          msg: err.message || "Failed to load invoices.",
          kind: "error",
        });
      }
    );

    return () => unsub();
  }, [orgId]);

  // Load jobs (org scoped) for invoice creation dropdown
  useEffect(() => {
    if (!orgId) return;

    const q = query(
      collection(db, "jobs").withConverter(jobConverter),
      where("orgId", "==", orgId),
      orderBy("updatedAt", "desc")
    );

    const unsub = onSnapshot(
      q,
      (snap) => setJobs(snap.docs.map((d) => d.data())),
      (err) =>
        setToast({ msg: err.message || "Failed to load jobs.", kind: "error" })
    );

    return () => unsub();
  }, [orgId]);

  // Stats
  const totalInvoices = invoices.length;
  const totalAmount = invoices.reduce(
    (sum, inv) => sum + (inv.money?.totalCents ?? 0),
    0
  );
  const outstandingAmount = invoices.reduce((sum, inv) => {
    if (inv.status === "draft" || inv.status === "sent")
      return sum + (inv.money?.totalCents ?? 0);
    return sum;
  }, 0);
  const paidAmount = invoices.reduce(
    (sum, inv) =>
      inv.status === "paid" ? sum + (inv.money?.totalCents ?? 0) : sum,
    0
  );

  // Filtered invoices
  const filteredInvoices = useMemo(() => {
    let list = invoices;

    if (statusFilter !== "all")
      list = list.filter((inv) => inv.status === statusFilter);

    const term = searchTerm.trim().toLowerCase();
    if (term) {
      list = list.filter((inv) => {
        const hay = [
          inv.number,
          inv.customer?.name,
          inv.customer?.email,
          inv.jobId,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return hay.includes(term);
      });
    }

    return list;
  }, [invoices, statusFilter, searchTerm]);

  const selectedInvoiceJob = useMemo(() => {
    if (!selectedInvoice) return null;
    return jobs.find((j) => j.id === selectedInvoice.jobId) ?? null;
  }, [selectedInvoice, jobs]);

  async function markInvoicePaid(inv: InvoiceDoc) {
    if (!orgId) return;

    setMarkingPaid(true);
    try {
      // extra safety: never mark paid across orgs
      if (inv.orgId !== orgId)
        throw new Error("Cross-org invoice update blocked.");

      const ref = doc(db, "invoices", inv.id);
      await updateDoc(ref, {
        status: "paid",
        updatedAt: serverTimestamp() as unknown as FieldValue,
        paymentNote: `Marked paid on ${new Date().toLocaleDateString()}`,
      });

      setToast({ msg: "Invoice marked as paid.", kind: "success" });
    } catch (e: any) {
      setToast({
        msg: e?.message ?? "Failed to mark invoice paid.",
        kind: "error",
      });
    } finally {
      setMarkingPaid(false);
      setSelectedInvoice(null);
    }
  }

  if (orgLoading) return <div className="p-4">Loading invoices…</div>;
  if (!orgId)
    return (
      <div className="p-8 text-rose-700">
        You are not linked to an organization. Please contact your admin.
      </div>
    );

  return (
    <div className="min-h-screen bg-gradient-to-b from-black/0 via-black/0 to-black/0">
      <div className="mx-auto w-[min(1100px,94vw)] space-y-8 py-8">
        {/* Summary */}
        <section className="rounded-2xl border border-[var(--color-border)]/60 bg-white/90 p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-[var(--color-text)]">
            Invoices Overview
          </h2>
          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            <div className="rounded-xl bg-white/60 p-4 shadow-md border border-[var(--color-border)]/40">
              <div className="text-xl font-semibold text-[var(--color-text)]">
                {totalInvoices}
              </div>
              <div className="text-xs uppercase tracking-wide text-[var(--color-muted)]">
                Total
              </div>
            </div>
            <div className="rounded-xl bg-white/60 p-4 shadow-md border border-[var(--color-border)]/40">
              <div className="text-xl font-semibold text-[var(--color-text)]">
                {money(totalAmount)}
              </div>
              <div className="text-xs uppercase tracking-wide text-[var(--color-muted)]">
                Billed
              </div>
            </div>
            <div className="rounded-xl bg-white/60 p-4 shadow-md border border-[var(--color-border)]/40">
              <div className="text-xl font-semibold text-[var(--color-text)]">
                {money(outstandingAmount)}
              </div>
              <div className="text-xs uppercase tracking-wide text-[var(--color-muted)]">
                Outstanding
              </div>
            </div>
            <div className="rounded-xl bg-white/60 p-4 shadow-md border border-[var(--color-border)]/40">
              <div className="text-xl font-semibold text-[var(--color-text)]">
                {money(paidAmount)}
              </div>
              <div className="text-xs uppercase tracking-wide text-[var(--color-muted)]">
                Paid
              </div>
            </div>
          </div>
        </section>

        {/* Filters + Action */}
        <section className="flex flex-col gap-3 sm:flex-row sm:items-end justify-between">
          <div className="flex flex-col sm:flex-row gap-2 items-start sm:items-center">
            <input
              type="text"
              placeholder="Search invoices…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="rounded-xl border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
            />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className="rounded-xl border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
            >
              <option value="all">All statuses</option>
              <option value="draft">Draft</option>
              <option value="sent">Sent</option>
              <option value="paid">Paid</option>
              <option value="void">Void</option>
            </select>
          </div>

          <button
            type="button"
            onClick={() => setOpenForm(true)}
            className="inline-flex items-center gap-2 rounded-xl bg-emerald-800 hover:bg-emerald-700 transition px-4 py-2 text-sm font-semibold text-white"
          >
            <Plus className="h-4 w-4" />
            New Invoice
          </button>
        </section>

        {/* List */}
        <section className="rounded-2xl border border-[var(--color-border)]/60 bg-white/90 shadow-sm overflow-hidden">
          <div className="grid grid-cols-[1.1fr_120px_160px_120px] gap-3 px-4 py-3 text-xs font-semibold text-[var(--color-muted)] border-b border-black/5">
            <div>Invoice</div>
            <div>Status</div>
            <div className="text-right">Total</div>
            <div className="text-right">Actions</div>
          </div>

          {filteredInvoices.length === 0 ? (
            <div className="p-6 text-sm text-[var(--color-muted)]">
              No invoices found.
            </div>
          ) : (
            <div className="divide-y divide-black/5">
              {filteredInvoices.map((inv) => (
                <div
                  key={inv.id}
                  className="grid grid-cols-[1.1fr_120px_160px_120px] gap-3 px-4 py-3 items-center"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-[var(--color-text)] truncate">
                      {inv.number}
                    </div>
                    <div className="text-xs text-[var(--color-muted)] truncate">
                      {inv.customer?.name ||
                        inv.addressSnapshot?.fullLine ||
                        `Job ${inv.jobId}`}
                    </div>
                  </div>

                  <div className="text-xs">
                    <span
                      className={cx(
                        "inline-flex rounded-lg px-2 py-1 font-semibold border",
                        inv.status === "paid" &&
                          "bg-emerald-50 text-emerald-700 border-emerald-200/60",
                        inv.status === "sent" &&
                          "bg-blue-50 text-blue-700 border-blue-200/60",
                        inv.status === "draft" &&
                          "bg-amber-50 text-amber-700 border-amber-200/60",
                        inv.status === "void" &&
                          "bg-gray-100 text-gray-700 border-gray-200"
                      )}
                    >
                      {inv.status}
                    </span>
                  </div>

                  <div className="text-right text-sm font-semibold text-[var(--color-text)]">
                    {money(inv.money?.totalCents ?? 0)}
                  </div>

                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => setSelectedInvoice(inv)}
                      className="rounded-xl border border-[var(--color-border)] bg-white px-3 py-2 text-xs font-semibold text-[var(--color-text)] hover:bg-[var(--color-card-hover)]"
                    >
                      View
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {openForm && (
        <NewInvoiceModal
          orgId={orgId}
          jobs={jobs}
          onClose={() => setOpenForm(false)}
          onCreated={(inv) => {
            setToast({
              msg:
                inv.status === "sent"
                  ? "Invoice sent (status updated)."
                  : "Invoice saved as draft.",
              kind: "success",
            });
          }}
        />
      )}

      {selectedInvoice && (
        <InvoicePreviewModal
          invoice={selectedInvoice}
          job={selectedInvoiceJob}
          onClose={() => setSelectedInvoice(null)}
          onMarkPaid={() => markInvoicePaid(selectedInvoice)}
          saving={markingPaid}
        />
      )}

      {toast && (
        <Toast
          message={toast.msg}
          kind={toast.kind}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  );
}
