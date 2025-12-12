import { createPortal } from "react-dom";
import type { Employee, PayoutDoc, EmployeeAddress, Job } from "../types/types";
import logo from "../assets/rogers-roofing.webp";

export type GlobalPayoutStubModalProps = {
  employee: Employee | null; // EmployeeDetailPage can just pass non-null
  payouts: PayoutDoc[];
  onClose: () => void;
  onConfirmPaid: () => Promise<void>;
  saving: boolean;
};
// Normalize Employee.address into a consistent shape
function normalizeEmployeeAddress(
  a: Employee["address"]
): EmployeeAddress | null {
  if (!a) return null;
  if (typeof a === "string") return { fullLine: a, line1: a };
  return a as EmployeeAddress;
}
// Simple money formatter for non-animated numbers (used in payouts section)
function money(cents: number | null | undefined): string {
  const v = typeof cents === "number" ? cents : 0;
  return (v / 100).toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
  });
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

export function GlobalPayoutStubModal({
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

  const formatCategory = (category: PayoutDoc["category"] | undefined) => {
    if (category === "shingles") return "Shingles";
    if (category === "felt") return "Felt";
    if (category === "technician") return "Technician";
    return "";
  };
  // In browsers, render the stub into <body> via a portal
  if (typeof document === "undefined") {
    // Safety guard (in case of SSR); nothing to render
    return null;
  }
  return createPortal(
    <div className="paystub-print fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
      <div className="paystub-print-inner w-full max-w-3xl rounded-md bg-white p-6 shadow-xl">
        {/* Header */}
        <div className="mb-4 flex  items-start justify-between gap-4">
          <div>
            <div className="flex gap-2 items-center">
              <img src={logo} className="max-w-[100px]" alt="" />
              <div>
                <h2 className="text-2xl font-semibold">
                  Roger&apos;s Roofing &amp; Contracting LLC
                </h2>
                {/* Static company address */}
                <h1>3618 Angus Crossing</h1>
                <p className="mt-0 text-xs">San Antonio, Texas 75245</p>
              </div>
            </div>

            {/* Dynamic employee info */}
            {employee && (
              <>
                <h1 className="mt-3 mb-0 text-lg">
                  <span className="font-medium">{employee.name}</span>
                </h1>

                {empAddr && (
                  <>
                    {/* Street / full line */}
                    {(empAddr.fullLine || empAddr.line1) && (
                      <h1 className="mt-[-3px] text-md">
                        {empAddr.fullLine || empAddr.line1}
                      </h1>
                    )}

                    {/* City, state, ZIP on its own line */}
                    {(empAddr.city || empAddr.state || empAddr.zip) && (
                      <p className="text-xs">
                        {[empAddr.city, empAddr.state, empAddr.zip]
                          .filter(Boolean)
                          .join(", ")}
                      </p>
                    )}
                  </>
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
                <th className="px-3 py-2 text-left">Material</th>
                <th className="px-3 py-2 text-left">SqCount</th>
                <th className="px-3 py-2 text-left">Rate</th>
                <th className="px-3 py-2 text-right">Total</th>
              </tr>
            </thead>

            <tbody>
              {payouts.map((p) => {
                const a = addr((p as any).jobAddressSnapshot as any);
                const materialLabel = formatCategory(p.category);

                return (
                  <tr key={p.id} className="border-t border-gray-100">
                    {/* Address */}
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

                    {/* Material */}
                    <td className="px-3 py-2 align-top text-sm text-gray-800">
                      {materialLabel || "—"}
                    </td>

                    {/* SqCount */}
                    <td className="px-3 py-2 align-top text-sm text-gray-800">
                      {typeof (p as any).sqft === "number"
                        ? (p as any).sqft.toLocaleString()
                        : "—"}
                    </td>

                    {/* Rate */}
                    <td className="px-3 py-2 align-top text-sm text-gray-800">
                      {typeof (p as any).ratePerSqFt === "number"
                        ? `$${(p as any).ratePerSqFt.toFixed(2)}/sq.ft`
                        : "—"}
                    </td>

                    {/* Total */}
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
    </div>,
    document.body
  );
}
