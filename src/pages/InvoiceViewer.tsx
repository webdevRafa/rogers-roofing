import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { collection, doc, getDoc } from "firebase/firestore";
import { db } from "../firebase/firebaseConfig";
import type { InvoiceDoc } from "../types/types";

function money(cents: number) {
  return (cents / 100).toLocaleString(undefined, { style: "currency", currency: "USD" });
}

// Timestamp helpers (avoid `any`)
type FsTimestampLike = { toDate: () => Date };
function isFsTimestamp(x: unknown): x is FsTimestampLike {
  return typeof (x as FsTimestampLike)?.toDate === "function";
}
function fmtDate(x: unknown): string {
  if (x == null) return "—";
  if (isFsTimestamp(x)) return x.toDate().toLocaleString();
  if (x instanceof Date) return x.toLocaleString();
  if (typeof x === "string" || typeof x === "number") {
    const d = new Date(x);
    return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
  }
  return "—";
}

export default function InvoiceViewer() {
  const { id } = useParams<{ id: string }>();
  const [inv, setInv] = useState<InvoiceDoc | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const ref = doc(collection(db, "invoices"), id as string);
        const snap = await getDoc(ref);
        if (!snap.exists()) throw new Error("Invoice not found");
        setInv(snap.data() as InvoiceDoc);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [id]);

  if (err) return <div className="p-6 text-red-600">{err}</div>;
  if (!inv) return <div className="p-6">Loading…</div>;

  return (
    <div className="mx-auto w-[min(900px,94vw)] py-8">
      <div className="mb-6 flex items-center justify-between">
        <Link to="/" className="text-sm text-blue-600 hover:underline">
          &larr; Back
        </Link>
        <div className="flex gap-2">
          <button onClick={() => window.print()} className="rounded-md bg-black px-3 py-2 text-sm text-white">
            Print / Save PDF
          </button>
          <button
            onClick={() => navigator.clipboard.writeText(window.location.href)}
            className="rounded-md border px-3 py-2 text-sm"
          >
            Copy link
          </button>
        </div>
      </div>

      <div className="rounded-2xl bg-white p-6 shadow">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-xs uppercase tracking-wider text-gray-500">
              {inv.kind === "invoice" ? "Invoice" : "Receipt"}
            </div>
            <h1 className="text-2xl font-semibold">#{inv.number}</h1>
            <div className="mt-1 text-sm text-gray-500">Job: {inv.addressSnapshot?.fullLine || "—"}</div>
          </div>
          <div className="text-right text-sm text-gray-600">
            <div>
              Status: <span className="font-medium">{inv.status}</span>
            </div>
            <div>Created: {fmtDate((inv as unknown as { createdAt?: unknown })?.createdAt)}</div>
          </div>
        </div>

        {inv.description && (
          <div className="mt-4 rounded-lg bg-gray-50 p-3 text-sm text-gray-800">{inv.description}</div>
        )}

        <div className="mt-6">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="py-2">Item</th>
                <th className="py-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {inv.lines.map((l) => (
                <tr key={l.id} className="border-b last:border-0">
                  <td className="py-2 pr-3">{l.label}</td>
                  <td className="py-2 text-right">{money(l.amountCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-6 grid gap-1 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-600">Subtotal</span>
            <span className="font-medium">{money(inv.money.subtotalCents)}</span>
          </div>
          {inv.money.taxCents > 0 && (
            <div className="flex justify-between">
              <span className="text-gray-600">Tax</span>
              <span className="font-medium">{money(inv.money.taxCents)}</span>
            </div>
          )}
          <div className="flex justify-between text-lg">
            <span className="font-semibold">Total</span>
            <span className="font-semibold">{money(inv.money.totalCents)}</span>
          </div>
        </div>

        {inv.kind === "receipt" && inv.paymentNote && (
          <div className="mt-4 text-sm text-gray-700">Payment note: {inv.paymentNote}</div>
        )}
      </div>
    </div>
  );
}
