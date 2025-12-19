// src/pages/InvoicesPage.tsx
// A complete invoice management page for Roger's Roofing.
//
// This page allows admins/managers to view, filter and create
// invoices tied to jobs. It also includes rich summary cards,
// printable invoice previews and status controls. The design
// matches other pages (JobsPage, FinancialOverviewPage) using
// the same Tailwind aesthetics and patterns.

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

// Helper to format money from cents to dollars
function money(cents: number | null | undefined): string {
  const v = typeof cents === "number" ? cents : 0;
  return (v / 100).toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// Generate a human friendly invoice number like INV-2025-000123
async function generateInvoiceNumber(orgId: string): Promise<string> {
  const year = new Date().getFullYear();
  // Query invoices for this org and this year to find the max sequence
  const prefix = `INV-${year}-`;
  try {
    const q = query(
      collection(db, "invoices"),
      where("orgId", "==", orgId),
      where("number", ">=", prefix),
      where("number", "<=", prefix + "\uffff"),
      orderBy("number", "desc"),
      orderBy("createdAt", "desc")
      // fetch just a few
    );
    const snap = await getDocs(q);
    let maxSeq = 0;
    snap.forEach((doc) => {
      const num = (doc.data() as InvoiceDoc).number;
      const parts = num.split("-");
      const seqStr = parts[2];
      const seq = Number(seqStr);
      if (Number.isFinite(seq) && seq > maxSeq) maxSeq = seq;
    });
    const nextSeq = (maxSeq + 1).toString().padStart(6, "0");
    return `${prefix}${nextSeq}`;
  } catch {
    // fallback to timestamp based id
    const ts = Date.now().toString().slice(-6);
    return `${prefix}${ts}`;
  }
}

/**
 * Modal for creating a new invoice. Accepts a list of jobs so the user can
 * choose which job to invoice. It derives default line items from the selected
 * job (labor and materials) and allows adding custom extras. A description
 * and customer details may also be provided. On save it creates a new
 * InvoiceDoc in Firestore.
 */
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

  // Basic form state
  const [jobId, setJobId] = useState<string>(jobs[0]?.id ?? "");
  const [customerName, setCustomerName] = useState<string>("");
  const [customerEmail, setCustomerEmail] = useState<string>("");
  const [customerPhone, setCustomerPhone] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [extras, setExtras] = useState<{ label: string; amount: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const selectedJob = useMemo(
    () => jobs.find((j) => j.id === jobId) ?? null,
    [jobs, jobId]
  );

  // Derived line amounts for labor and materials
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
  const taxCents = 0; // reserved for future
  const totalCents = subtotalCents + taxCents;

  // Helper to add a new empty extra line
  function addExtra() {
    setExtras((prev) => [...prev, { label: "", amount: "" }]);
  }
  function removeExtra(idx: number) {
    setExtras((prev) => prev.filter((_, i) => i !== idx));
  }

  async function submit(status: InvoiceStatus) {
    setFormError(null);
    if (!orgId) {
      setFormError("Organization not loaded.");
      return;
    }
    if (!selectedJob) {
      setFormError("Please select a job to invoice.");
      return;
    }
    // Build invoice lines: labor, materials, extras (only if > 0)
    const lines: InvoiceLine[] = [];
    if (laborCents > 0) {
      lines.push({
        id: "labor",
        label: "Labor (payouts)",
        amountCents: laborCents,
      });
    }
    if (materialsCents > 0) {
      lines.push({
        id: "materials",
        label: "Materials",
        amountCents: materialsCents,
      });
    }
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
      // Pre-generate invoice number
      const number = await generateInvoiceNumber(orgId);
      // Prepare invoice doc
      const docRef = doc(collection(db, "invoices"));
      const invoice: InvoiceDoc = {
        id: docRef.id,
        kind: "invoice",
        jobId: selectedJob.id,
        number,
        customer: {
          name: customerName || undefined,
          email: customerEmail || undefined,
          phone: customerPhone || undefined,
        },
        addressSnapshot: {
          fullLine:
            typeof selectedJob.address === "string"
              ? selectedJob.address
              : selectedJob.address.fullLine,
          line1:
            typeof selectedJob.address === "string"
              ? selectedJob.address
              : selectedJob.address.street,
          city:
            typeof selectedJob.address === "string"
              ? undefined
              : selectedJob.address.city,
          state:
            typeof selectedJob.address === "string"
              ? undefined
              : selectedJob.address.state,
          zip:
            typeof selectedJob.address === "string"
              ? undefined
              : selectedJob.address.postalCode,
        },
        description: description || undefined,
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
        status,
        paymentNote: undefined,
        orgId,
      };
      await setDoc(docRef, invoice as any);
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
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 p-3">
      {/* click-away overlay */}
      <button
        type="button"
        onClick={onClose}
        className="absolute inset-0 cursor-default"
        aria-label="Close"
      />
      <div className="relative w-full max-w-2xl rounded-2xl bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-gray-100 px-6 py-5">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-[var(--color-primary)]/10 text-[var(--color-primary)]">
              <FileText className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-[var(--color-text)]">
                Create invoice
              </h2>
              <p className="mt-1 text-xs text-[var(--color-muted)]">
                Generate an invoice from a job
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-gray-300 px-2 py-1 text-[11px] text-gray-600 hover:bg-gray-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {/* Body */}
        <div className="px-6 py-5">
          {formError && (
            <div className="mb-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {formError}
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            {/* Job select */}
            <div className="sm:col-span-2">
              <label className="text-[10px] uppercase tracking-wide text-gray-500">
                Job
              </label>
              <select
                value={jobId}
                onChange={(e) => setJobId(e.target.value)}
                disabled={saving || jobs.length === 0}
                className="mt-1 w-full rounded-xl border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-accent)] disabled:opacity-60"
              >
                {jobs.length === 0 && <option>No jobs available</option>}
                {jobs.map((j) => (
                  <option key={j.id} value={j.id}>
                    {typeof j.address === "string"
                      ? j.address
                      : j.address.fullLine}
                  </option>
                ))}
              </select>
            </div>
            {/* Customer name */}
            <div>
              <label className="text-[10px] uppercase tracking-wide text-gray-500">
                Customer name
              </label>
              <input
                type="text"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                disabled={saving}
                className="mt-1 w-full rounded-xl border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-accent)] disabled:opacity-60"
                placeholder="e.g. Jane Doe"
              />
            </div>
            {/* Customer email */}
            <div>
              <label className="text-[10px] uppercase tracking-wide text-gray-500">
                Customer email
              </label>
              <input
                type="email"
                value={customerEmail}
                onChange={(e) => setCustomerEmail(e.target.value)}
                disabled={saving}
                className="mt-1 w-full rounded-xl border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-accent)] disabled:opacity-60"
                placeholder="email@example.com"
              />
            </div>
            {/* Customer phone */}
            <div>
              <label className="text-[10px] uppercase tracking-wide text-gray-500">
                Customer phone
              </label>
              <input
                type="tel"
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                disabled={saving}
                className="mt-1 w-full rounded-xl border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-accent)] disabled:opacity-60"
                placeholder="(555) 123‑4567"
              />
            </div>
            {/* Description */}
            <div className="sm:col-span-2">
              <label className="text-[10px] uppercase tracking-wide text-gray-500">
                Description
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={saving}
                rows={2}
                placeholder="Describe the work performed"
                className="mt-1 w-full resize-none rounded-xl border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-accent)] disabled:opacity-60"
              />
            </div>
            {/* Labor and materials preview */}
            <div>
              <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-2">
                <div className="text-[10px] uppercase tracking-wide text-[var(--color-muted)]">
                  Labor
                </div>
                <div className="mt-1 text-lg font-semibold text-[var(--color-text)]">
                  {money(laborCents)}
                </div>
              </div>
            </div>
            <div>
              <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-2">
                <div className="text-[10px] uppercase tracking-wide text-[var(--color-muted)]">
                  Materials
                </div>
                <div className="mt-1 text-lg font-semibold text-[var(--color-text)]">
                  {money(materialsCents)}
                </div>
              </div>
            </div>
            {/* Extras editor */}
            <div className="sm:col-span-2">
              <div className="flex items-center justify-between">
                <label className="text-[10px] uppercase tracking-wide text-gray-500">
                  Extras
                </label>
                <button
                  type="button"
                  onClick={addExtra}
                  disabled={saving}
                  className="flex items-center gap-1 text-sm text-[var(--color-primary)] hover:underline disabled:opacity-60"
                >
                  <Plus className="h-4 w-4" /> Add
                </button>
              </div>
              {extras.length === 0 && (
                <p className="mt-1 text-xs text-[var(--color-muted)]">
                  No extras added
                </p>
              )}
              {extras.map((ex, idx) => (
                <div
                  key={idx}
                  className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-end"
                >
                  <div className="flex-1">
                    <label className="text-[10px] uppercase tracking-wide text-gray-500">
                      Label
                    </label>
                    <input
                      type="text"
                      value={ex.label}
                      onChange={(e) => {
                        const v = e.target.value;
                        setExtras((prev) =>
                          prev.map((item, i) =>
                            i === idx ? { ...item, label: v } : item
                          )
                        );
                      }}
                      disabled={saving}
                      className="mt-1 w-full rounded-xl border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-accent)] disabled:opacity-60"
                      placeholder="e.g. Dumpster rental"
                    />
                  </div>
                  <div className="w-32">
                    <label className="text-[10px] uppercase tracking-wide text-gray-500">
                      Amount ($)
                    </label>
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      value={ex.amount}
                      onChange={(e) => {
                        const v = e.target.value;
                        setExtras((prev) =>
                          prev.map((item, i) =>
                            i === idx ? { ...item, amount: v } : item
                          )
                        );
                      }}
                      disabled={saving}
                      className="mt-1 w-full rounded-xl border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-accent)] disabled:opacity-60"
                      placeholder="0.00"
                    />
                  </div>
                  <div className="flex items-center justify-center sm:justify-start">
                    <button
                      type="button"
                      onClick={() => removeExtra(idx)}
                      disabled={saving}
                      className="ml-2 inline-flex items-center justify-center rounded-md bg-red-50 px-2 py-2 text-xs text-red-600 hover:bg-red-100 disabled:opacity-60"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
            {/* Totals preview */}
            <div className="sm:col-span-2 mt-3">
              <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-2">
                <div className="text-[10px] uppercase tracking-wide text-[var(--color-muted)]">
                  Subtotal
                </div>
                <div className="mt-1 text-lg font-semibold text-[var(--color-text)]">
                  {money(subtotalCents)}
                </div>
                {extraCents > 0 && (
                  <div className="mt-0.5 text-[11px] text-[var(--color-muted)]">
                    Extras: {money(extraCents)}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
        {/* Footer */}
        <div className="flex flex-col-reverse gap-2 border-t border-gray-100 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-60"
          >
            Cancel
          </button>
          <div className="flex flex-col sm:flex-row gap-2">
            <button
              type="button"
              onClick={() => submit("draft")}
              disabled={saving}
              className="rounded-lg bg-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-300 disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save draft"}
            </button>
            <button
              type="button"
              onClick={() => submit("sent")}
              disabled={saving}
              className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-600 disabled:opacity-60"
            >
              {saving ? "Sending…" : "Save & Send"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
  return createPortal(content, document.body);
}

/**
 * Modal to preview and print an invoice. Renders a professional invoice
 * layout with company branding, customer/job details and line items. It
 * includes actions to print/save to PDF and mark the invoice as paid.
 */
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
  onMarkPaid: () => Promise<void>;
  saving: boolean;
}) {
  if (typeof document === "undefined") return null;
  // Helper to display address
  const jobAddr = useMemo(() => {
    if (!job) return { display: "", city: "", state: "", zip: "" };
    const a = job.address;
    if (typeof a === "string") {
      return { display: a, city: "", state: "", zip: "" };
    }
    return {
      display: a.fullLine ?? "",
      city: a.city ?? "",
      state: a.state ?? "",
      zip: a.postalCode ?? "",
    };
  }, [job]);

  const creationDate = useMemo(() => {
    let dt: Date | null = null;
    const anyDate = invoice.createdAt as any;
    if (anyDate?.toDate) dt = anyDate.toDate();
    else if (anyDate instanceof Date) dt = anyDate;
    if (!dt) return "";
    return dt.toLocaleDateString(undefined, {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  }, [invoice.createdAt]);

  const subtotal = invoice.money?.subtotalCents ?? 0;
  const tax = invoice.money?.taxCents ?? 0;
  const total = invoice.money?.totalCents ?? 0;

  const content = (
    <div className="paystub-print fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
      <div className="paystub-print-inner w-full max-w-3xl rounded-md bg-white p-6 shadow-xl">
        {/* Header: company info and invoice meta */}
        <div className="mb-4 flex flex-col sm:flex-row items-start justify-between gap-4">
          <div>
            <div className="flex gap-2 items-center">
              {/* Company branding - adapt your logo path */}
              <img
                src={require("../assets/rogers-roofing.webp")}
                className="max-w-[100px]"
                alt="Company Logo"
              />
              <div>
                <h2 className="text-2xl font-semibold">
                  Roger&apos;s Roofing & Contracting LLC
                </h2>
                <h1 className="text-sm">3618 Angus Crossing</h1>
                <p className="mt-0 text-xs">San Antonio, Texas 75245</p>
              </div>
            </div>
            {/* Customer details */}
            {invoice.customer && (
              <div className="mt-4">
                <h3 className="text-sm font-medium">Bill To:</h3>
                {invoice.customer.name && (
                  <p className="text-sm">{invoice.customer.name}</p>
                )}
                {invoice.customer.email && (
                  <p className="text-sm">{invoice.customer.email}</p>
                )}
                {invoice.customer.phone && (
                  <p className="text-sm">{invoice.customer.phone}</p>
                )}
              </div>
            )}
            {/* Job address */}
            {job && (
              <div className="mt-3 text-sm">
                <h3 className="font-medium">Job Address:</h3>
                <p>{jobAddr.display}</p>
                {jobAddr.city && (
                  <p>
                    {[jobAddr.city, jobAddr.state, jobAddr.zip]
                      .filter(Boolean)
                      .join(", ")}
                  </p>
                )}
              </div>
            )}
          </div>
          <div className="text-right text-sm">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-gray-300 px-2 py-1 text-[11px] text-gray-600 hover:bg-gray-100 print:hidden"
            >
              Close
            </button>
            <div className="mt-6">
              <p className="text-xs text-gray-500">Invoice #</p>
              <p className="text-base font-semibold">{invoice.number}</p>
              <p className="mt-2 text-xs text-gray-500">Date</p>
              <p className="text-base font-semibold">{creationDate}</p>
            </div>
          </div>
        </div>
        {/* Description */}
        {invoice.description && (
          <div className="mb-4 text-sm">
            <p className="font-medium">Description</p>
            <p>{invoice.description}</p>
          </div>
        )}
        {/* Line items table */}
        <div className="mt-4 overflow-hidden rounded-xl border border-gray-200">
          <table className="min-w-full text-xs sm:text-sm">
            <thead className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-3 py-2 text-left">Item</th>
                <th className="px-3 py-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {invoice.lines.map((ln) => (
                <tr key={ln.id} className="border-t border-gray-100">
                  <td className="px-3 py-2 align-top text-sm text-gray-800">
                    {ln.label}
                  </td>
                  <td className="px-3 py-2 align-top text-right text-sm font-semibold text-gray-900">
                    {money(ln.amountCents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* Totals */}
        <div className="mt-4 flex flex-col items-end">
          <div className="text-right text-sm">
            <div className="flex justify-between gap-4">
              <span className="text-gray-500">Subtotal</span>
              <span className="font-medium text-gray-800">
                {money(subtotal)}
              </span>
            </div>
            <div className="flex justify-between gap-4 mt-1">
              <span className="text-gray-500">Tax</span>
              <span className="font-medium text-gray-800">{money(tax)}</span>
            </div>
            <div className="flex justify-between gap-4 mt-2 border-t border-gray-200 pt-2">
              <span className="text-gray-500">Total</span>
              <span className="font-semibold text-gray-900">
                {money(total)}
              </span>
            </div>
          </div>
        </div>
        {/* Actions */}
        <div className="mt-6 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => window.print()}
            className="rounded-md border border-gray-300 px-3 py-2 text-xs text-gray-700 hover:bg-gray-100 print:hidden"
          >
            <Printer className="inline-block h-4 w-4 mr-1" /> Print / Save PDF
          </button>
          {invoice.status !== "paid" && (
            <button
              type="button"
              onClick={onMarkPaid}
              disabled={saving}
              className="rounded-md bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-60 print:hidden"
            >
              {saving ? "Marking…" : "Mark as paid"}
            </button>
          )}
          {invoice.status === "paid" && (
            <span className="inline-flex items-center gap-1 rounded-md bg-green-100 px-3 py-2 text-xs font-medium text-green-700">
              <CheckCircle className="h-4 w-4" /> Paid
            </span>
          )}
        </div>
      </div>
    </div>
  );
  return createPortal(content, document.body);
}

/**
 * Main InvoicesPage component. Displays summary cards, invoice list with
 * filters and actions, and modals for creating and printing invoices.
 */
export default function InvoicesPage() {
  const { orgId, loading: orgLoading } = useOrg();
  const [invoices, setInvoices] = useState<InvoiceDoc[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<"all" | InvoiceStatus>(
    "all"
  );
  const [openForm, setOpenForm] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<InvoiceDoc | null>(
    null
  );
  const [markingPaid, setMarkingPaid] = useState(false);

  // Subscribe to invoices for the current organisation
  useEffect(() => {
    if (!orgId) return;
    const q = query(
      collection(db, "invoices"),
      where("orgId", "==", orgId),
      orderBy("createdAt", "desc")
    );
    const unsub = onSnapshot(q, (snap) => {
      const list: InvoiceDoc[] = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<InvoiceDoc, "id">),
      }));
      setInvoices(list);
    });
    return () => unsub();
  }, [orgId]);

  // Load jobs for invoice creation dropdown
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

  // Derived stats
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
  const paidAmount = invoices.reduce((sum, inv) => {
    if (inv.status === "paid") return sum + (inv.money?.totalCents ?? 0);
    return sum;
  }, 0);

  // Filtered invoices
  const filteredInvoices = useMemo(() => {
    let list = invoices;
    if (statusFilter !== "all") {
      list = list.filter((inv) => inv.status === statusFilter);
    }
    const term = searchTerm.trim().toLowerCase();
    if (term) {
      list = list.filter((inv) => {
        const haystack = [
          inv.number,
          inv.customer?.name,
          inv.customer?.email,
          inv.jobId,
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(term);
      });
    }
    return list;
  }, [invoices, statusFilter, searchTerm]);

  // When previewing invoice, we need its associated job
  const selectedInvoiceJob = useMemo(() => {
    if (!selectedInvoice) return null;
    return jobs.find((j) => j.id === selectedInvoice.jobId) ?? null;
  }, [selectedInvoice, jobs]);

  async function markInvoicePaid(inv: InvoiceDoc) {
    if (!orgId) return;
    setMarkingPaid(true);
    try {
      const ref = doc(db, "invoices", inv.id);
      await updateDoc(ref, {
        status: "paid",
        updatedAt: serverTimestamp() as unknown as FieldValue,
        paymentNote: `Marked paid on ${new Date().toLocaleDateString()}`,
      });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(e);
    } finally {
      setMarkingPaid(false);
      setSelectedInvoice(null);
    }
  }

  // Loading and guard states
  if (orgLoading) {
    return <div className="p-4">Loading invoices…</div>;
  }
  if (!orgId) {
    return (
      <div className="p-8 text-red-600">
        You are not linked to an organization. Please contact your admin.
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b ">
      <div className="mx-auto w-[min(1100px,94vw)] space-y-8 py-8">
        {/* Summary cards */}
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
                Total Invoices
              </div>
            </div>
            <div className="rounded-xl bg-white/60 p-4 shadow-md border border-[var(--color-border)]/40">
              <div className="text-xl font-semibold text-[var(--color-text)]">
                {money(totalAmount)}
              </div>
              <div className="text-xs uppercase tracking-wide text-[var(--color-muted)]">
                Total Amount
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
        {/* Filters and actions */}
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
            className="inline-flex items-center gap-1 rounded-lg bg-emerald-800 hover:bg-emerald-700 transition px-4 py-2 text-sm font-semibold text-white"
          >
            <Plus className="h-4 w-4" /> New Invoice
          </button>
        </section>
        {/* Invoice list table */}
        <section className="rounded-2xl border border-[var(--color-border)]/60 bg-white/90 p-4 shadow-sm overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-[var(--color-card)] text-[11px] uppercase tracking-wide text-[var(--color-muted)]">
              <tr>
                <th className="px-3 py-2 text-left">Number</th>
                <th className="px-3 py-2 text-left">Job</th>
                <th className="px-3 py-2 text-left">Customer</th>
                <th className="px-3 py-2 text-left">Date</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-right">Total</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredInvoices.length === 0 && (
                <tr>
                  <td
                    colSpan={7}
                    className="px-3 py-4 text-center text-[var(--color-muted)] text-sm"
                  >
                    No invoices found
                  </td>
                </tr>
              )}
              {filteredInvoices.map((inv) => {
                // find job address or use jobId
                const job = jobs.find((j) => j.id === inv.jobId);
                const address = job
                  ? typeof job.address === "string"
                    ? job.address
                    : job.address.fullLine
                  : inv.jobId;
                // compute date string
                let dateStr = "";
                const dtAny = inv.createdAt as any;
                if (dtAny?.toDate) {
                  dateStr = dtAny.toDate().toLocaleDateString();
                } else if (dtAny instanceof Date) {
                  dateStr = dtAny.toLocaleDateString();
                }
                return (
                  <tr
                    key={inv.id}
                    className="border-t border-[var(--color-border)]/40 hover:bg-[var(--color-card)]"
                  >
                    <td className="px-3 py-2 align-top">{inv.number}</td>
                    <td className="px-3 py-2 align-top">
                      <div className="font-medium text-[var(--color-text)]">
                        {address}
                      </div>
                    </td>
                    <td className="px-3 py-2 align-top">
                      {inv.customer?.name || inv.customer?.email || "—"}
                    </td>
                    <td className="px-3 py-2 align-top">{dateStr}</td>
                    <td className="px-3 py-2 align-top">
                      <span
                        className={
                          inv.status === "paid"
                            ? "inline-block rounded-full bg-green-100 px-2 py-1 text-xs font-medium text-green-800"
                            : inv.status === "sent"
                            ? "inline-block rounded-full bg-yellow-100 px-2 py-1 text-xs font-medium text-yellow-800"
                            : inv.status === "draft"
                            ? "inline-block rounded-full bg-gray-200 px-2 py-1 text-xs font-medium text-gray-700"
                            : "inline-block rounded-full bg-red-100 px-2 py-1 text-xs font-medium text-red-800"
                        }
                      >
                        {inv.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 align-top text-right font-semibold">
                      {money(inv.money?.totalCents)}
                    </td>
                    <td className="px-3 py-2 align-top text-right space-x-2">
                      <button
                        type="button"
                        onClick={() => setSelectedInvoice(inv)}
                        className="rounded-md border border-gray-300 px-2 py-1 text-[11px] text-gray-700 hover:bg-gray-100"
                      >
                        View
                      </button>
                      {inv.status !== "paid" && (
                        <button
                          type="button"
                          onClick={() => markInvoicePaid(inv)}
                          disabled={markingPaid}
                          className="rounded-md bg-emerald-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
                        >
                          {markingPaid ? "Updating…" : "Mark paid"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      </div>
      {/* Create invoice modal */}
      {openForm && (
        <NewInvoiceModal
          orgId={orgId}
          jobs={jobs}
          onClose={() => setOpenForm(false)}
          onCreated={() => {
            // Could trigger a toast here e.g. using react-hot-toast; omitted for brevity
          }}
        />
      )}
      {/* Invoice preview modal */}
      {selectedInvoice && (
        <InvoicePreviewModal
          invoice={selectedInvoice}
          job={selectedInvoiceJob}
          onClose={() => setSelectedInvoice(null)}
          onMarkPaid={async () => {
            await markInvoicePaid(selectedInvoice);
          }}
          saving={markingPaid}
        />
      )}
    </div>
  );
}
