import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Printer, ShieldCheck, X } from "lucide-react";
import type { Job } from "../types/types";

type JobPhoto = {
  id: string;
  jobId: string;
  createdAt?: any;
  fullUrl?: string;
  thumbUrl?: string;
  url?: string;
  caption?: string;
};

type ReportMode = "internal" | "external";

function fmtCents(cents: number) {
  const dollars = (cents ?? 0) / 100;
  return dollars.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  });
}

function safePhotoUrl(p: JobPhoto) {
  return p.thumbUrl || p.fullUrl || p.url || "";
}

function fmtMaybeDate(v: any) {
  if (!v) return "—";
  if (typeof v?.toDate === "function") return v.toDate().toLocaleString();
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

export default function WarrantyReportModal({
  open,
  onClose,
  job,
  photos,
  totals,
}: {
  open: boolean;
  onClose: () => void;
  job: Job;
  photos: JobPhoto[];
  totals: { earnings: number; expenses: number; net: number };
}) {
  const [mode, setMode] = useState<ReportMode>("internal");

  const address = job.address?.fullLine || job.id;

  const createdLabel = useMemo(
    () => fmtMaybeDate((job as any).createdAt),
    [job]
  );
  const updatedLabel = useMemo(
    () => fmtMaybeDate((job as any).updatedAt),
    [job]
  );

  // Future-proof: if you add job.warranty later, we’ll show it automatically.
  const warranty = (job as any).warranty as
    | {
        kind?: string;
        manufacturer?: string;
        programName?: string;
        coverageYears?: number;
        registeredAt?: any;
        registrationId?: string;
        claimId?: string;
        portalUrl?: string;
        notes?: string;
      }
    | undefined;

  // Nice defaults for external view, even before you store warranty meta.
  const externalSummary = useMemo(() => {
    const parts: string[] = [];

    if (warranty?.kind) parts.push(`Type: ${warranty.kind}`);
    if (warranty?.manufacturer)
      parts.push(`Manufacturer: ${warranty.manufacturer}`);
    if (warranty?.programName) parts.push(`Program: ${warranty.programName}`);
    if (typeof warranty?.coverageYears === "number")
      parts.push(`Coverage: ${warranty.coverageYears} yrs`);
    if (warranty?.registrationId)
      parts.push(`Registration ID: ${warranty.registrationId}`);
    if (warranty?.claimId) parts.push(`Claim ID: ${warranty.claimId}`);
    if (warranty?.registeredAt)
      parts.push(`Registered: ${fmtMaybeDate(warranty.registeredAt)}`);
    if (warranty?.portalUrl) parts.push(`Portal: ${warranty.portalUrl}`);

    return parts;
  }, [warranty]);

  if (!open) return null;

  return createPortal(
    <div className="paystub-print fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 print:bg-transparent print:p-0">
      {/* Backdrop (click to close, hidden on print) */}
      <button
        type="button"
        className="absolute inset-0 print:hidden"
        aria-label="Close"
        onClick={onClose}
      />

      {/* The only thing visible during print */}
      <div className="paystub-print-inner relative flex w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl ring-1 ring-black/10 max-h-[calc(100vh-2rem)] print:max-h-none print:overflow-visible print:max-w-none print:rounded-none print:shadow-none print:ring-0">
        {/* Top bar (hidden on print) */}
        <div className="flex flex-col gap-3 border-b border-black/10 px-4 py-3 print:hidden sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200">
              <ShieldCheck className="h-5 w-5" />
            </span>
            <div>
              <div className="text-sm font-semibold text-[var(--color-text)]">
                Warranty / 3rd party packet
              </div>
              <div className="text-xs text-[var(--color-muted)]">
                Choose internal or external, then print / save PDF
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Mode toggle */}
            <div className="inline-flex rounded-lg border border-black/10 bg-white p-1">
              <button
                type="button"
                onClick={() => setMode("internal")}
                className={
                  "rounded-md px-3 py-1.5 text-xs font-semibold transition " +
                  (mode === "internal"
                    ? "bg-cyan-800 text-white"
                    : "text-[var(--color-text)] hover:bg-black/5")
                }
                title="Internal packet (includes financials)"
              >
                Internal
              </button>
              <button
                type="button"
                onClick={() => setMode("external")}
                className={
                  "rounded-md px-3 py-1.5 text-xs font-semibold transition " +
                  (mode === "external"
                    ? "bg-cyan-800 text-white"
                    : "text-[var(--color-text)] hover:bg-black/5")
                }
                title="External packet (no financials)"
              >
                External
              </button>
            </div>

            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-2 rounded-lg bg-cyan-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-cyan-700 transition"
            >
              <Printer className="h-4 w-4" />
              Print / Save PDF
            </button>

            <button
              type="button"
              onClick={onClose}
              className="rounded-full p-2 text-gray-500 hover:bg-gray-100"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* PRINT CONTENT */}
        <div className="p-5 print:p-6 overflow-y-auto print:overflow-visible">
          {/* Title */}
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-xs uppercase tracking-wide text-[var(--color-muted)]">
                Job
              </div>
              <div className="mt-1 text-xl font-semibold text-[var(--color-text)]">
                {address}
              </div>
              <div className="mt-1 text-xs text-[var(--color-muted)]">
                Job ID:{" "}
                <span className="font-medium text-[var(--color-text)]">
                  {job.id}
                </span>
              </div>
              <div className="mt-1 text-xs text-[var(--color-muted)]">
                Packet type:{" "}
                <span className="font-semibold text-[var(--color-text)]">
                  {mode === "internal"
                    ? "Internal (financials included)"
                    : "External (no financials)"}
                </span>
              </div>
            </div>

            <div className="text-right text-xs text-[var(--color-muted)]">
              <div>
                Created:{" "}
                <span className="text-[var(--color-text)]">{createdLabel}</span>
              </div>
              <div>
                Updated:{" "}
                <span className="text-[var(--color-text)]">{updatedLabel}</span>
              </div>
              <div className="mt-1">
                Status:{" "}
                <span className="font-medium text-[var(--color-text)]">
                  {(job as any).status || "—"}
                </span>
              </div>
            </div>
          </div>

          <div className="my-5 h-px w-full bg-black/10" />

          {/* Internal: Profit summary  |  External: Warranty details */}
          {mode === "internal" ? (
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-black/10 bg-white p-3">
                <div className="text-xs text-[var(--color-muted)]">
                  Earnings
                </div>
                <div className="mt-1 text-lg font-semibold text-[var(--color-text)]">
                  {fmtCents(totals.earnings)}
                </div>
              </div>

              <div className="rounded-xl border border-black/10 bg-white p-3">
                <div className="text-xs text-[var(--color-muted)]">
                  Expenses
                </div>
                <div className="mt-1 text-lg font-semibold text-[var(--color-text)]">
                  {fmtCents(totals.expenses)}
                </div>
              </div>

              <div
                className={
                  "rounded-xl border border-black/10 p-3 " +
                  (totals.net >= 0 ? "bg-emerald-50" : "bg-red-50")
                }
              >
                <div className="text-xs text-[var(--color-muted)]">Profit</div>
                <div className="mt-1 text-lg font-semibold text-[var(--color-text)]">
                  {fmtCents(totals.net)}
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-black/10 bg-white p-4">
              <div className="text-sm font-semibold text-[var(--color-text)]">
                Warranty / 3rd-party details
              </div>

              {externalSummary.length > 0 ? (
                <ul className="mt-2 space-y-1 text-sm text-[var(--color-text)]">
                  {externalSummary.map((line) => (
                    <li key={line} className="break-words">
                      {line}
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="mt-2 text-sm text-[var(--color-muted)]">
                  No warranty metadata saved yet. (Later we can add quick fields
                  like type, manufacturer, claim ID, registration ID.)
                </div>
              )}

              {warranty?.notes ? (
                <div className="mt-3">
                  <div className="text-xs uppercase tracking-wide text-[var(--color-muted)]">
                    Warranty notes
                  </div>
                  <div className="mt-1 whitespace-pre-wrap break-words text-sm text-[var(--color-text)]">
                    {warranty.notes}
                  </div>
                </div>
              ) : null}
            </div>
          )}

          {/* Notes */}
          <div className="mt-6">
            <div className="text-sm font-semibold text-[var(--color-text)]">
              Notes
            </div>
            <div className="mt-2 space-y-2">
              {((job as any).notes ?? []).length === 0 ? (
                <div className="text-sm text-[var(--color-muted)]">
                  No notes.
                </div>
              ) : (
                ((job as any).notes ?? []).map((n: any) => (
                  <div
                    key={n.id}
                    className="rounded-xl border border-black/10 bg-white p-3"
                  >
                    <div className="text-sm text-[var(--color-text)] whitespace-pre-wrap break-words">
                      {n.text || ""}
                    </div>
                    {n.createdAt && (
                      <div className="mt-1 text-xs text-[var(--color-muted)]">
                        {fmtMaybeDate(n.createdAt)}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Photos */}
          <div className="mt-6">
            <div className="text-sm font-semibold text-[var(--color-text)]">
              Photos
            </div>

            {photos.length === 0 ? (
              <div className="mt-2 text-sm text-[var(--color-muted)]">
                No photos.
              </div>
            ) : (
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 print:grid-cols-3">
                {photos.slice(0, 12).map((p) => {
                  const src = safePhotoUrl(p);
                  if (!src) return null;
                  return (
                    <div
                      key={p.id}
                      className="overflow-hidden rounded-xl border border-black/10 bg-white"
                    >
                      <img
                        src={src}
                        alt={p.caption || "Job photo"}
                        className="h-36 w-full object-cover print:h-32"
                      />
                      <div className="px-2 py-2 text-xs text-[var(--color-text)]">
                        {p.caption || "—"}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {photos.length > 12 ? (
              <div className="mt-2 text-xs text-[var(--color-muted)]">
                Showing 12 of {photos.length} photos (we can expand this later).
              </div>
            ) : null}
          </div>

          {/* Footer */}
          <div className="mt-8 text-xs text-[var(--color-muted)]">
            {mode === "internal"
              ? "Internal packet (includes financial snapshot) for tracking warranty / third-party impact."
              : "External packet (no financials) for manufacturer / builder / insurance documentation."}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
