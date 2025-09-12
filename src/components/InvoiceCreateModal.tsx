import { useState } from "react";
import { collection, doc, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "../firebase/firebaseConfig";
import type { FieldValue } from "firebase/firestore";
import type { Job, InvoiceDoc, InvoiceLine, InvoiceMoney, InvoiceKind } from "../types/types";

// ---------------- helpers ----------------
function pad(n: number, w = 6) {
  return String(n).padStart(w, "0");
}
function makeInvoiceNumber(seq: number) {
  const y = new Date().getFullYear();
  return `INV-${y}-${pad(seq)}`; // swap to a firestore counter later if you want strict ordering
}
function dollarsToCents(n: number) {
  return Math.round(n * 100);
}

// string picker without using `any`
function pickString(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v;
  }
  return undefined;
}

// normalize Job["address"] without any `any` casts
function normalizeAddress(a: Job["address"] | undefined): InvoiceDoc["addressSnapshot"] | undefined {
  if (!a) return undefined;
  if (typeof a === "string") return { fullLine: a, line1: a };

  const obj: Record<string, unknown> = a as Record<string, unknown>;

  const fullLine =
    pickString(obj, ["fullLine", "full", "formatted", "label", "text"]) ??
    pickString(obj, ["line1", "street", "address", "address1", "street1"]);

  const line1 = pickString(obj, ["line1", "street", "address", "address1", "street1"]);
  const city = pickString(obj, ["city", "town"]);
  const state = pickString(obj, ["state", "region", "province"]);
  const zip = pickString(obj, ["zip", "postalCode", "postcode", "zipCode"]);

  return {
    fullLine: fullLine,
    line1: line1,
    city: city,
    state: state,
    zip: zip,
  };
}

export default function InvoiceCreateModal({
  job,
  open,
  onClose,
}: {
  job: Job;
  open: boolean;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<InvoiceKind>("invoice");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [description, setDescription] = useState("");
  const [extraLabel, setExtraLabel] = useState("");
  const [extraAmount, setExtraAmount] = useState<string>("");

  if (!open) return null;

  function buildLines(): InvoiceLine[] {
    const lines: InvoiceLine[] = [];

    const laborCents = job?.expenses?.totalPayoutsCents ?? 0;
    if (laborCents > 0) lines.push({ id: crypto.randomUUID(), label: "Labor (payouts)", amountCents: laborCents });

    const materialsCents = job?.expenses?.totalMaterialsCents ?? 0;
    if (materialsCents > 0)
      lines.push({ id: crypto.randomUUID(), label: "Materials", amountCents: materialsCents });

    const extraNum = Number(extraAmount);
    if (Number.isFinite(extraNum) && extraNum > 0) {
      lines.push({
        id: crypto.randomUUID(),
        label: extraLabel.trim() || "Extra expense",
        amountCents: dollarsToCents(extraNum),
      });
    }

    return lines;
  }

  function computeMoney(lines: InvoiceLine[]): InvoiceMoney {
    let materials = 0;
    let labor = 0;
    let extras = 0;

    for (const l of lines) {
      const key = l.label.toLowerCase();
      if (key.startsWith("labor")) labor += l.amountCents;
      else if (key.startsWith("materials")) materials += l.amountCents;
      else extras += l.amountCents;
    }

    const subtotal = materials + labor + extras;
    const tax = 0; // add configurable tax later
    const total = subtotal + tax;

    return {
      materialsCents: materials,
      laborCents: labor,
      extraCents: extras,
      subtotalCents: subtotal,
      taxCents: tax,
      totalCents: total,
    };
  }

  async function handleCreate() {
    const lines = buildLines();
    const money = computeMoney(lines);

    // TEMP number; replace with a counter when you want strict incrementing IDs
    const number = makeInvoiceNumber(Math.floor(Math.random() * 100000));

    const invRef = doc(collection(db, "invoices"));
    const invoice: InvoiceDoc = {
      id: invRef.id,
      kind,
      jobId: job.id,
      number,
      customer: {
        name: name || undefined,
        email: email || undefined,
      },
      addressSnapshot: normalizeAddress(job.address),
      description: description || undefined,
      lines,
      money,
      status: kind === "receipt" ? "paid" : "draft",
      createdAt: serverTimestamp() as FieldValue,
      updatedAt: serverTimestamp() as FieldValue,
    };

    await setDoc(invRef, invoice);
    onClose();
    window.location.assign(`/invoices/${invoice.id}`);
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white p-4 shadow-xl">
        <h3 className="text-lg font-semibold">New {kind === "invoice" ? "Invoice" : "Receipt"}</h3>

        <div className="mt-3 grid gap-3">
          <div className="flex gap-2">
            <button
              onClick={() => setKind("invoice")}
              className={`rounded-md px-3 py-1 text-sm border ${
                kind === "invoice" ? "bg-black text-white" : "bg-white"
              }`}
            >
              Invoice
            </button>
            <button
              onClick={() => setKind("receipt")}
              className={`rounded-md px-3 py-1 text-sm border ${
                kind === "receipt" ? "bg-black text-white" : "bg-white"
              }`}
            >
              Receipt
            </button>
          </div>

          <div>
            <label className="text-xs text-gray-600">Customer name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="text-xs text-gray-600">Customer email (optional)</label>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="text-xs text-gray-600">Job description (shown on {kind})</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
            />
          </div>

          <div className="grid grid-cols-[1fr_140px] gap-2">
            <input
              value={extraLabel}
              onChange={(e) => setExtraLabel(e.target.value)}
              placeholder="Extra item label (optional)"
              className="rounded-md border px-3 py-2 text-sm"
            />
            <input
              value={extraAmount}
              onChange={(e) => setExtraAmount(e.target.value)}
              placeholder="$0.00"
              type="number"
              step="0.01"
              min={0}
              className="rounded-md border px-3 py-2 text-sm"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button onClick={onClose} className="rounded-md border px-3 py-2 text-sm">
              Cancel
            </button>
            <button onClick={handleCreate} className="rounded-md bg-black px-4 py-2 text-sm text-white">
              Create
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
