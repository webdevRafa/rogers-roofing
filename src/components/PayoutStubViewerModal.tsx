import { createPortal } from "react-dom";
import type {
  EmployeeAddress,
  Job,
  PayoutStubDoc,
  PayoutStubLine,
} from "../types/types";
import logo from "../assets/rogers-roofing.webp";

export type PayoutStubViewerModalProps = {
  stub: PayoutStubDoc;
  onClose: () => void;
};

// Simple money formatter
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

type FsTimestampLike = { toDate: () => Date };
function isFsTimestamp(x: unknown): x is FsTimestampLike {
  return typeof (x as FsTimestampLike)?.toDate === "function";
}
function fmtDate(x: unknown): string {
  if (x == null) return "—";
  if (isFsTimestamp(x)) return x.toDate().toLocaleDateString();
  if (x instanceof Date) return x.toLocaleDateString();
  if (typeof x === "string" || typeof x === "number") {
    const d = new Date(x);
    return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
  }
  return "—";
}

function formatCategory(category: PayoutStubLine["category"] | undefined) {
  if (category === "shingles") return "Shingles";
  if (category === "felt") return "Felt";
  if (category === "technician") return "Technician";
  return "";
}

function normalizeEmployeeAddress(
  a: PayoutStubDoc["employeeAddressSnapshot"]
): EmployeeAddress | null {
  if (!a) return null;
  if (typeof a === "string") return { fullLine: a, line1: a };
  return a as EmployeeAddress;
}

export function PayoutStubViewerModal({
  stub,
  onClose,
}: PayoutStubViewerModalProps) {
  // In browsers, render the stub into <body> via a portal (matches GlobalPayoutStubModal)
  if (typeof document === "undefined") return null;

  const empAddr = normalizeEmployeeAddress(stub.employeeAddressSnapshot);
  const totalCents =
    typeof stub.totalCents === "number"
      ? stub.totalCents
      : (stub.lines ?? []).reduce((sum, l) => sum + (l.amountCents ?? 0), 0);

  const content = (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 p-3 print:static print:bg-transparent print:p-0">
      {/* Click-away overlay (not on print) */}
      <button
        type="button"
        onClick={onClose}
        className="absolute inset-0 hidden cursor-default print:hidden md:block"
        aria-label="Close"
      />

      {/* Modal card */}
      <div className="relative w-full max-w-4xl rounded-2xl bg-white shadow-xl print:max-w-none print:rounded-none print:shadow-none">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-gray-100 px-6 py-5 print:border-0 print:px-0 print:py-0">
          <div className="flex items-start gap-4">
            <img
              src={logo}
              alt="Company logo"
              className="h-10 w-10 rounded-md object-cover print:hidden"
            />
            <div>
              <div className="text-xs text-gray-500">
                Pay stub • {stub.number || stub.id}
              </div>
              <h2 className="text-lg font-semibold text-gray-900">
                {stub.employeeNameSnapshot || "Employee"}
              </h2>

              <div className="mt-1 text-[12px] text-gray-600">
                <span className="font-medium">Created:</span>{" "}
                {fmtDate(stub.createdAt)}
                {stub.paidAt && (
                  <>
                    {" "}
                    • <span className="font-medium">Paid:</span>{" "}
                    {fmtDate(stub.paidAt)}
                  </>
                )}
              </div>

              {empAddr?.fullLine && (
                <div className="mt-1 text-[12px] text-gray-600">
                  <span className="font-medium">Employee address:</span>{" "}
                  {empAddr.fullLine}
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 print:hidden">
            <button
              type="button"
              onClick={() => window.print()}
              className="rounded-md border border-gray-300 px-3 py-2 text-xs text-gray-700 hover:bg-gray-100"
            >
              Print / Save PDF
            </button>

            <button
              type="button"
              onClick={onClose}
              className="rounded-md bg-gray-900 px-3 py-2 text-xs font-semibold text-white hover:bg-gray-800"
            >
              Close
            </button>
          </div>
        </div>

        {/* Table */}
        <div className="px-6 py-5 print:px-0 print:py-0">
          <div className="overflow-hidden rounded-xl border border-gray-100 print:border-0">
            <table className="min-w-full">
              <thead className="bg-gray-50 print:bg-transparent">
                <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                  <th className="px-3 py-2">Address</th>
                  <th className="px-3 py-2">Material</th>
                  <th className="px-3 py-2">Sq.Ft</th>
                  <th className="px-3 py-2">Rate</th>
                  <th className="px-3 py-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {(stub.lines ?? []).map((line, idx) => {
                  const a = addr((line as any).jobAddressSnapshot as any);
                  const materialLabel = formatCategory(line.category);

                  return (
                    <tr
                      key={`${line.payoutId}-${idx}`}
                      className="border-t border-gray-100"
                    >
                      {/* Address */}
                      <td className="px-3 py-2 align-top">
                        <div className="font-medium text-gray-900">
                          {a.display || "—"}
                        </div>
                        {(a.city || a.state || a.zip) && (
                          <div className="text-[11px] text-gray-500">
                            {[a.city, a.state, a.zip]
                              .filter(Boolean)
                              .join(", ")}
                          </div>
                        )}
                      </td>

                      {/* Material */}
                      <td className="px-3 py-2 align-top text-sm text-gray-800">
                        {materialLabel || "—"}
                      </td>

                      {/* SqFt */}
                      <td className="px-3 py-2 align-top text-sm text-gray-800">
                        {typeof line.sqft === "number"
                          ? line.sqft.toLocaleString()
                          : "—"}
                      </td>

                      {/* Rate */}
                      <td className="px-3 py-2 align-top text-sm text-gray-800">
                        {typeof line.ratePerSqFt === "number"
                          ? `$${line.ratePerSqFt.toFixed(2)}/sq.ft`
                          : "—"}
                      </td>

                      {/* Total */}
                      <td className="px-3 py-2 align-top text-right text-sm font-semibold text-gray-900">
                        {money(line.amountCents ?? 0)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Totals (matches GlobalPayoutStubModal print layout) */}
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm text-gray-700 print:hidden">
              <div className="print:hidden">
                <span className="font-medium">Number of payouts:</span>{" "}
                {(stub.lines ?? []).length}
              </div>
              <div className="mt-1 text-lg font-semibold">
                Total: {money(totalCents)}
              </div>
            </div>

            {/* PRINT-ONLY totals (right aligned on PDF) */}
            <div className="hidden print:flex w-full justify-end">
              <div className="text-right">
                <div className="text-[11px] text-gray-500">Grand total</div>
                <div className="mt-1 text-lg font-semibold text-gray-900">
                  {money(totalCents)}
                </div>
              </div>
            </div>
          </div>

          {/* Footer note (print-safe) */}
          <div className="mt-6 text-[11px] text-gray-500 print:mt-3">
            Generated from saved pay stub history.
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
