import { useMemo } from "react";
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
  const address = job.address?.fullLine || job.id;

  const createdLabel = useMemo(() => {
    const v: any = job.createdAt;
    if (!v) return "—";
    if (typeof v?.toDate === "function") return v.toDate().toLocaleString();
    const d = v instanceof Date ? v : new Date(v);
    return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
  }, [job.createdAt]);

  const updatedLabel = useMemo(() => {
    const v: any = job.updatedAt;
    if (!v) return "—";
    if (typeof v?.toDate === "function") return v.toDate().toLocaleString();
    const d = v instanceof Date ? v : new Date(v);
    return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
  }, [job.updatedAt]);

  if (!open) return null;

  return createPortal(
    <div className="paystub-print fixed inset-0 z-50 grid place-items-center bg-black/40 p-4 print:bg-transparent print:p-0">
      {/* Backdrop (hidden on print) */}
      <div
        className="paystub-print-inner w-full max-w-4xl rounded-2xl bg-white shadow-xl ring-1 ring-black/10 print:max-w-none print:rounded-none print:shadow-none print:ring-0"
        onClick={onClose}
      />

      {/* Print wrapper (re-uses your paystub-like print approach) */}
      <div className="relative mx-auto mt-10 md:mt-40 w-full max-w-4xl px-4 pb-10 print:mt-0 print:max-w-none print:px-0">
        <div className="rounded-2xl bg-white shadow-xl ring-1 ring-black/10 print:rounded-none print:shadow-none">
          {/* Header bar (hidden on print) */}
          <div className="flex items-center justify-between border-b border-black/10 px-4 py-3 print:hidden">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200">
                <ShieldCheck className="h-5 w-5" />
              </span>
              <div>
                <div className="text-sm font-semibold text-[var(--color-text)]">
                  Warranty / 3rd party packet
                </div>
                <div className="text-xs text-[var(--color-muted)]">
                  Print or Save as PDF
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
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
          <div className="p-5 print:p-6">
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
              </div>

              <div className="text-right text-xs text-[var(--color-muted)]">
                <div>
                  Created:{" "}
                  <span className="text-[var(--color-text)]">
                    {createdLabel}
                  </span>
                </div>
                <div>
                  Updated:{" "}
                  <span className="text-[var(--color-text)]">
                    {updatedLabel}
                  </span>
                </div>
                <div className="mt-1">
                  Status:{" "}
                  <span className="font-medium text-[var(--color-text)]">
                    {job.status || "—"}
                  </span>
                </div>
              </div>
            </div>

            <div className="my-5 h-px w-full bg-black/10" />

            {/* Profit summary */}
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

            {/* Notes */}
            <div className="mt-6">
              <div className="text-sm font-semibold text-[var(--color-text)]">
                Notes
              </div>
              <div className="mt-2 space-y-2">
                {(job.notes ?? []).length === 0 ? (
                  <div className="text-sm text-[var(--color-muted)]">
                    No notes.
                  </div>
                ) : (
                  (job.notes ?? []).map((n: any) => (
                    <div
                      key={n.id}
                      className="rounded-xl border border-black/10 bg-white p-3"
                    >
                      <div className="text-sm text-[var(--color-text)] whitespace-pre-wrap break-words">
                        {n.text || ""}
                      </div>
                      {n.createdAt && (
                        <div className="mt-1 text-xs text-[var(--color-muted)]">
                          {typeof n.createdAt?.toDate === "function"
                            ? n.createdAt.toDate().toLocaleString()
                            : String(n.createdAt)}
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
                        {p.caption ? (
                          <div className="px-2 py-2 text-xs text-[var(--color-text)]">
                            {p.caption}
                          </div>
                        ) : (
                          <div className="px-2 py-2 text-xs text-[var(--color-muted)]">
                            —
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {photos.length > 12 ? (
                <div className="mt-2 text-xs text-[var(--color-muted)]">
                  Showing 12 of {photos.length} photos (we can expand this
                  later).
                </div>
              ) : null}
            </div>

            {/* Footer */}
            <div className="mt-8 text-xs text-[var(--color-muted)]">
              Generated from the job record (profit, notes, photos) for warranty
              / third-party documentation.
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
