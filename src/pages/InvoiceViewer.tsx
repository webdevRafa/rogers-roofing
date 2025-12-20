import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { collection, doc, getDoc } from "firebase/firestore";
import { db } from "../firebase/firebaseConfig";
import type { InvoiceDoc } from "../types/types";

// ✅ Use same logo concept as InvoicesPage modal (adjust path if needed)
import logo from "../assets/rogers-roofing.webp";

// ---------- helpers ----------
function money(cents: number | null | undefined) {
  const v = typeof cents === "number" ? cents : 0;
  return (v / 100).toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// Timestamp helpers (avoid `any`)
type FsTimestampLike = { toDate: () => Date };
function isFsTimestamp(x: unknown): x is FsTimestampLike {
  return typeof (x as FsTimestampLike)?.toDate === "function";
}
function fmtDateTime(x: unknown): string {
  if (x == null) return "—";
  if (isFsTimestamp(x)) return x.toDate().toLocaleString();
  if (x instanceof Date) return x.toLocaleString();
  if (typeof x === "string" || typeof x === "number") {
    const d = new Date(x);
    return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
  }
  return "—";
}

function statusPill(status: InvoiceDoc["status"]) {
  // matches the vibes of your admin table pills
  switch (status) {
    case "paid":
      return "bg-green-100 text-green-800";
    case "sent":
      return "bg-yellow-100 text-yellow-800";
    case "draft":
      return "bg-gray-200 text-gray-700";
    default:
      return "bg-red-100 text-red-800";
  }
}

export default function InvoiceViewer() {
  const { id } = useParams<{ id: string }>();
  const [inv, setInv] = useState<InvoiceDoc | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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

  useEffect(() => {
    const root = document.getElementById("root");
    if (!root) return;

    // Tell the global print CSS "this is the printable surface"
    root.classList.add("paystub-print");

    // Optional but recommended: apply the "inner" layout rules too
    // (We'll add this class to your invoice card below, not the root)
    return () => {
      root.classList.remove("paystub-print");
    };
  }, []);

  const createdLabel = useMemo(() => {
    if (!inv) return "—";
    return fmtDateTime((inv as unknown as { createdAt?: unknown })?.createdAt);
  }, [inv]);

  if (err) {
    return (
      <div className="min-h-screen bg-slate-50 grid place-items-center p-6">
        <div className="w-full max-w-lg rounded-2xl border border-red-200 bg-white p-6 shadow-sm">
          <div className="text-sm font-semibold text-red-700">Error</div>
          <div className="mt-1 text-sm text-red-600">{err}</div>
        </div>
      </div>
    );
  }

  if (!inv) {
    return (
      <div className="min-h-screen bg-slate-50 grid place-items-center p-6">
        <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="text-sm text-slate-600">Loading invoice…</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Top action bar (non-print) */}
      <div className="mx-auto w-[min(980px,94vw)] pt-10 print:hidden">
        <div className="mb-4 flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => window.print()}
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-100"
          >
            Print / Save PDF
          </button>

          <button
            type="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(window.location.href);
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1200);
              } catch {
                // no-op
              }
            }}
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-100"
          >
            {copied ? "Copied!" : "Copy link"}
          </button>
        </div>
      </div>

      {/* Printable invoice surface */}
      <div className="mx-auto w-[min(980px,94vw)] pb-14">
        <div
          className="
          paystub-print-inner rounded-2xl bg-white p-6 shadow-sm border border-slate-200/60
            print:rounded-none print:shadow-none print:border-0 print:p-0
          "
        >
          {/* Header */}
          <div className="mb-6 flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            {/* Branding + Bill To + Job */}
            <div className="min-w-0">
              <div className="flex items-center gap-3">
                <img
                  src={logo}
                  alt="Roger's Roofing logo"
                  className="h-12 w-12 rounded-xl border border-slate-200 shadow-sm"
                />
                <div className="min-w-0">
                  <div className="text-lg font-semibold text-slate-900 leading-5">
                    Roger&apos;s Roofing &amp; Contracting LLC
                  </div>
                  <div className="mt-1 text-xs text-slate-600">
                    3618 Angus Crossing
                  </div>
                  <div className="text-xs text-slate-600">
                    San Antonio, Texas 75245
                  </div>
                </div>
              </div>

              {(inv.customer?.name ||
                inv.customer?.email ||
                inv.customer?.phone) && (
                <div className="mt-5">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Bill To
                  </div>
                  <div className="mt-1 text-sm text-slate-800">
                    {inv.customer?.name && <div>{inv.customer.name}</div>}
                    {inv.customer?.email && (
                      <div className="text-slate-700">{inv.customer.email}</div>
                    )}
                    {inv.customer?.phone && (
                      <div className="text-slate-700">{inv.customer.phone}</div>
                    )}
                  </div>
                </div>
              )}

              <div className="mt-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Job Address
                </div>
                <div className="mt-1 text-sm text-slate-800">
                  {inv.addressSnapshot?.fullLine ||
                    inv.addressSnapshot?.line1 ||
                    "—"}
                </div>
                {(inv.addressSnapshot?.city ||
                  inv.addressSnapshot?.state ||
                  inv.addressSnapshot?.zip) && (
                  <div className="text-sm text-slate-700">
                    {[
                      inv.addressSnapshot?.city,
                      inv.addressSnapshot?.state,
                      inv.addressSnapshot?.zip,
                    ]
                      .filter(Boolean)
                      .join(", ")}
                  </div>
                )}
              </div>
            </div>

            {/* Invoice meta */}
            <div className="shrink-0 text-left sm:text-right">
              <div className="text-xs uppercase tracking-wider text-slate-500">
                {inv.kind === "invoice" ? "Invoice" : "Receipt"}
              </div>

              <div className="mt-1 text-xs font-semibold text-slate-900">
                #{inv.number}
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2 sm:justify-end">
                <span
                  className={[
                    "inline-flex items-center rounded-full px-2 py-1 text-[11px] font-medium",
                    statusPill(inv.status),
                  ].join(" ")}
                >
                  {inv.status}
                </span>

                <span className="text-xs text-slate-600">
                  Created: <span className="font-medium">{createdLabel}</span>
                </span>
              </div>
            </div>
          </div>

          {/* Description */}
          {inv.description && (
            <div className="mb-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Notes
              </div>
              <div className="mt-1 text-sm text-slate-800">
                {inv.description}
              </div>
            </div>
          )}

          {/* Line items table */}
          <div className="overflow-hidden rounded-xl border border-slate-200">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3 text-left">Item</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {inv.lines.map((ln) => (
                  <tr key={ln.id} className="border-t border-slate-100">
                    <td className="px-4 py-3 align-top text-slate-800">
                      {ln.label}
                    </td>
                    <td className="px-4 py-3 align-top text-right font-semibold text-slate-900">
                      {money(ln.amountCents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Totals */}
          <div className="mt-5 flex justify-end">
            <div className="w-full max-w-sm space-y-2 text-sm">
              <div className="flex justify-between gap-6">
                <span className="text-slate-600">Subtotal</span>
                <span className="font-medium text-slate-900">
                  {money(inv.money?.subtotalCents)}
                </span>
              </div>

              {(inv.money?.taxCents ?? 0) > 0 && (
                <div className="flex justify-between gap-6">
                  <span className="text-slate-600">Tax</span>
                  <span className="font-medium text-slate-900">
                    {money(inv.money?.taxCents)}
                  </span>
                </div>
              )}

              <div className="flex justify-between gap-6 border-t border-slate-200 pt-3 text-base">
                <span className="font-semibold text-slate-900">Total</span>
                <span className="font-semibold text-slate-900">
                  {money(inv.money?.totalCents)}
                </span>
              </div>
            </div>
          </div>

          {/* Footer note (customer-friendly) */}
          <div className="mt-8 border-t border-slate-200 pt-4 text-xs text-slate-500">
            Thank you for your business. If you have questions about this
            invoice, please contact Roger&apos;s Roofing &amp; Contracting LLC.
          </div>
        </div>
      </div>
    </div>
  );
}
