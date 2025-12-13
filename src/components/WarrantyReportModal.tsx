import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  Printer,
  ShieldCheck,
  X,
  ExternalLink,
  FileText,
  User,
  Phone,
  Mail,
  BadgeCheck,
  AlertCircle,
} from "lucide-react";
import type { Job, WarrantyMeta, WarrantyAttachment } from "../types/types";

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

type FsTimestampLike = { toDate: () => Date };
function isFsTimestamp(x: unknown): x is FsTimestampLike {
  return typeof (x as FsTimestampLike)?.toDate === "function";
}

function toDateObj(x: unknown): Date | null {
  if (!x) return null;
  if (isFsTimestamp(x)) return x.toDate();
  if (x instanceof Date) return x;
  if (typeof x === "string" || typeof x === "number") {
    const d = new Date(x);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function fmtMaybeDate(v: unknown) {
  const d = toDateObj(v);
  return d ? d.toLocaleString() : "—";
}

function fmtMaybeShortDate(v: unknown) {
  const d = toDateObj(v);
  return d ? d.toLocaleDateString() : "—";
}

function safePhotoUrl(p: JobPhoto) {
  return p.thumbUrl || p.fullUrl || p.url || "";
}

function isValidHttpUrl(url: string) {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function pillForWarrantyStatus(status?: WarrantyMeta["status"]) {
  switch (status) {
    case "registered":
    case "active":
      return "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200";
    case "submitted":
    case "claimOpened":
      return "bg-yellow-50 text-yellow-800 ring-1 ring-yellow-200";
    case "expired":
    case "closed":
      return "bg-gray-100 text-gray-700 ring-1 ring-black/10";
    case "draft":
    case "notStarted":
    default:
      return "bg-neutral-100 text-neutral-700 ring-1 ring-black/10";
  }
}

function labelForWarrantyKind(kind?: WarrantyMeta["kind"]) {
  switch (kind) {
    case "manufacturer":
      return "Manufacturer";
    case "workmanship":
      return "Workmanship";
    case "thirdParty":
      return "3rd Party";
    case "insurance":
      return "Insurance";
    case "none":
      return "None";
    default:
      return "—";
  }
}

function kindLabelForAttachmentKind(kind?: WarrantyAttachment["kind"]) {
  switch (kind) {
    case "invoice":
      return "Invoice";
    case "receipt":
      return "Receipt";
    case "warrantyCertificate":
      return "Warranty certificate";
    case "registrationConfirmation":
      return "Registration confirmation";
    case "claimDocument":
      return "Claim document";
    case "beforePhoto":
      return "Before photo";
    case "afterPhoto":
      return "After photo";
    case "other":
    default:
      return "Attachment";
  }
}

function ContactBlock({
  title,
  name,
  phone,
  email,
}: {
  title: string;
  name?: string;
  phone?: string;
  email?: string;
}) {
  const hasAny = Boolean(name || phone || email);
  if (!hasAny) return null;

  return (
    <div className="rounded-xl border border-black/10 bg-white p-3">
      <div className="text-xs uppercase tracking-wide text-[var(--color-muted)]">
        {title}
      </div>

      <div className="mt-2 space-y-1 text-sm text-[var(--color-text)]">
        {name ? (
          <div className="flex items-center gap-2">
            <User className="h-4 w-4 text-black/50" />
            <span className="break-words">{name}</span>
          </div>
        ) : null}

        {phone ? (
          <div className="flex items-center gap-2">
            <Phone className="h-4 w-4 text-black/50" />
            <span className="break-words">{phone}</span>
          </div>
        ) : null}

        {email ? (
          <div className="flex items-center gap-2">
            <Mail className="h-4 w-4 text-black/50" />
            <span className="break-words">{email}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
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
    () => fmtMaybeDate(job.createdAt),
    [job.createdAt]
  );
  const updatedLabel = useMemo(
    () => fmtMaybeDate(job.updatedAt),
    [job.updatedAt]
  );

  const warranty = job.warranty; // ✅ now uses your real type

  const hasWarrantyData = useMemo(() => {
    if (!warranty) return false;
    // Treat kind "none" as effectively empty unless other fields exist
    const hasMeaningful =
      (warranty.kind && warranty.kind !== "none") ||
      Boolean(
        warranty.manufacturer ||
          warranty.programName ||
          warranty.coverageYears ||
          warranty.status ||
          warranty.portalUrl ||
          warranty.registrationId ||
          warranty.claimId ||
          warranty.claimNumber ||
          warranty.claimStatus ||
          warranty.insuranceCarrier ||
          warranty.policyNumber ||
          warranty.notes ||
          warranty.installDate ||
          warranty.repairDate ||
          warranty.expiresAt ||
          (warranty.attachments && warranty.attachments.length > 0) ||
          warranty.homeowner?.name ||
          warranty.homeowner?.phone ||
          warranty.homeowner?.email ||
          warranty.adjuster?.name ||
          warranty.adjuster?.phone ||
          warranty.adjuster?.email ||
          warranty.thirdPartyAdmin?.name ||
          warranty.thirdPartyAdmin?.phone ||
          warranty.thirdPartyAdmin?.email
      );

    return Boolean(hasMeaningful);
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
                  {job.status || "—"}
                </span>
              </div>
            </div>
          </div>

          <div className="my-5 h-px w-full bg-black/10" />

          {/* MODE HEADER SECTION */}
          {mode === "internal" ? (
            <>
              {/* Internal: Financial snapshot */}
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
                  <div className="text-xs text-[var(--color-muted)]">
                    Profit
                  </div>
                  <div className="mt-1 text-lg font-semibold text-[var(--color-text)]">
                    {fmtCents(totals.net)}
                  </div>
                </div>
              </div>

              {/* Internal: Warranty snapshot (nice to have, stays clean) */}
              <div className="mt-4">
                <div className="rounded-xl border border-black/10 bg-white p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-[var(--color-text)]">
                      Warranty snapshot
                    </div>
                    {warranty?.status ? (
                      <span
                        className={
                          "inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold " +
                          pillForWarrantyStatus(warranty.status)
                        }
                      >
                        <BadgeCheck className="h-3.5 w-3.5" />
                        {warranty.status}
                      </span>
                    ) : (
                      <span className="text-xs text-[var(--color-muted)]">
                        {hasWarrantyData ? "—" : "No warranty data"}
                      </span>
                    )}
                  </div>

                  {hasWarrantyData ? (
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <div className="text-sm text-[var(--color-text)]">
                        <div className="text-xs text-[var(--color-muted)]">
                          Type
                        </div>
                        <div className="mt-0.5 font-medium">
                          {labelForWarrantyKind(warranty?.kind)}
                        </div>
                      </div>

                      <div className="text-sm text-[var(--color-text)]">
                        <div className="text-xs text-[var(--color-muted)]">
                          Manufacturer / Program
                        </div>
                        <div className="mt-0.5 font-medium break-words">
                          {[warranty?.manufacturer, warranty?.programName]
                            .filter(Boolean)
                            .join(" — ") || "—"}
                        </div>
                      </div>

                      <div className="text-sm text-[var(--color-text)]">
                        <div className="text-xs text-[var(--color-muted)]">
                          Install date
                        </div>
                        <div className="mt-0.5 font-medium">
                          {fmtMaybeShortDate(warranty?.installDate)}
                        </div>
                      </div>

                      <div className="text-sm text-[var(--color-text)]">
                        <div className="text-xs text-[var(--color-muted)]">
                          Expires
                        </div>
                        <div className="mt-0.5 font-medium">
                          {fmtMaybeShortDate(warranty?.expiresAt)}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-2 flex items-center gap-2 text-sm text-[var(--color-muted)]">
                      <AlertCircle className="h-4 w-4" />
                      No warranty metadata saved yet.
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : (
            <>
              {/* External: Warranty / 3rd-party details (no financials) */}
              <div className="rounded-xl border border-black/10 bg-white p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-sm font-semibold text-[var(--color-text)]">
                    Warranty / 3rd-party details
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {warranty?.status ? (
                      <span
                        className={
                          "inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold " +
                          pillForWarrantyStatus(warranty.status)
                        }
                      >
                        <BadgeCheck className="h-3.5 w-3.5" />
                        {warranty.status}
                      </span>
                    ) : null}

                    {warranty?.kind ? (
                      <span className="inline-flex rounded-full bg-neutral-100 px-2 py-1 text-xs font-semibold text-neutral-700 ring-1 ring-black/10">
                        {labelForWarrantyKind(warranty.kind)}
                      </span>
                    ) : null}
                  </div>
                </div>

                {hasWarrantyData ? (
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    {/* Program */}
                    <div className="rounded-xl border border-black/10 bg-white p-3">
                      <div className="text-xs text-[var(--color-muted)]">
                        Manufacturer / Program
                      </div>
                      <div className="mt-1 text-sm font-semibold text-[var(--color-text)] break-words">
                        {[warranty?.manufacturer, warranty?.programName]
                          .filter(Boolean)
                          .join(" — ") || "—"}
                      </div>
                      {typeof warranty?.coverageYears === "number" ? (
                        <div className="mt-1 text-xs text-[var(--color-muted)]">
                          Coverage:{" "}
                          <span className="font-medium text-[var(--color-text)]">
                            {warranty.coverageYears} yrs
                          </span>
                        </div>
                      ) : null}
                    </div>

                    {/* Dates */}
                    <div className="rounded-xl border border-black/10 bg-white p-3">
                      <div className="text-xs text-[var(--color-muted)]">
                        Dates
                      </div>
                      <div className="mt-1 space-y-1 text-sm text-[var(--color-text)]">
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-[var(--color-muted)]">
                            Install
                          </span>
                          <span className="font-medium">
                            {fmtMaybeShortDate(warranty?.installDate)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-[var(--color-muted)]">
                            Repair
                          </span>
                          <span className="font-medium">
                            {fmtMaybeShortDate(warranty?.repairDate)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-[var(--color-muted)]">
                            Expires
                          </span>
                          <span className="font-medium">
                            {fmtMaybeShortDate(warranty?.expiresAt)}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Registration */}
                    <div className="rounded-xl border border-black/10 bg-white p-3">
                      <div className="text-xs text-[var(--color-muted)]">
                        Registration
                      </div>
                      <div className="mt-1 space-y-1 text-sm text-[var(--color-text)]">
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-[var(--color-muted)]">
                            Submitted
                          </span>
                          <span className="font-medium">
                            {fmtMaybeShortDate(warranty?.submittedAt)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-[var(--color-muted)]">
                            Registered
                          </span>
                          <span className="font-medium">
                            {fmtMaybeShortDate(warranty?.registeredAt)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-[var(--color-muted)]">ID</span>
                          <span className="font-medium break-words">
                            {warranty?.registrationId || "—"}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Claim */}
                    <div className="rounded-xl border border-black/10 bg-white p-3">
                      <div className="text-xs text-[var(--color-muted)]">
                        Claim
                      </div>
                      <div className="mt-1 space-y-1 text-sm text-[var(--color-text)]">
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-[var(--color-muted)]">
                            Claim ID
                          </span>
                          <span className="font-medium break-words">
                            {warranty?.claimId || "—"}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-[var(--color-muted)]">
                            Claim #
                          </span>
                          <span className="font-medium break-words">
                            {warranty?.claimNumber || "—"}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-[var(--color-muted)]">
                            Status
                          </span>
                          <span className="font-medium">
                            {warranty?.claimStatus || "—"}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-[var(--color-muted)]">
                            Opened
                          </span>
                          <span className="font-medium">
                            {fmtMaybeShortDate(warranty?.claimOpenedAt)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-[var(--color-muted)]">
                            Closed
                          </span>
                          <span className="font-medium">
                            {fmtMaybeShortDate(warranty?.claimClosedAt)}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Portal */}
                    <div className="rounded-xl border border-black/10 bg-white p-3 sm:col-span-2">
                      <div className="text-xs text-[var(--color-muted)]">
                        Portal / submission link
                      </div>

                      <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                        <div className="text-sm font-medium text-[var(--color-text)] break-words">
                          {warranty?.portalUrl || "—"}
                        </div>

                        {warranty?.portalUrl &&
                        isValidHttpUrl(warranty.portalUrl) ? (
                          <a
                            href={warranty.portalUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="print:hidden inline-flex items-center gap-1 rounded-lg border border-black/10 bg-white px-2 py-1 text-xs font-semibold text-[var(--color-text)] hover:bg-black/5"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                            Open
                          </a>
                        ) : null}
                      </div>

                      {warranty?.submittedBy?.name ? (
                        <div className="mt-1 text-xs text-[var(--color-muted)]">
                          Submitted by:{" "}
                          <span className="font-medium text-[var(--color-text)]">
                            {warranty.submittedBy.name}
                          </span>
                        </div>
                      ) : null}
                    </div>

                    {/* People */}
                    <div className="grid gap-3 sm:col-span-2 sm:grid-cols-3">
                      <ContactBlock
                        title="Homeowner"
                        name={warranty?.homeowner?.name}
                        phone={warranty?.homeowner?.phone}
                        email={warranty?.homeowner?.email}
                      />
                      <ContactBlock
                        title="Adjuster"
                        name={warranty?.adjuster?.name}
                        phone={warranty?.adjuster?.phone}
                        email={warranty?.adjuster?.email}
                      />
                      <ContactBlock
                        title="3rd party admin"
                        name={warranty?.thirdPartyAdmin?.name}
                        phone={warranty?.thirdPartyAdmin?.phone}
                        email={warranty?.thirdPartyAdmin?.email}
                      />
                    </div>

                    {/* Insurance metadata */}
                    {warranty?.insuranceCarrier || warranty?.policyNumber ? (
                      <div className="rounded-xl border border-black/10 bg-white p-3 sm:col-span-2">
                        <div className="text-xs uppercase tracking-wide text-[var(--color-muted)]">
                          Insurance
                        </div>

                        <div className="mt-2 grid gap-2 sm:grid-cols-2 text-sm">
                          <div>
                            <div className="text-xs text-[var(--color-muted)]">
                              Carrier
                            </div>
                            <div className="font-medium text-[var(--color-text)] break-words">
                              {warranty?.insuranceCarrier || "—"}
                            </div>
                          </div>

                          <div>
                            <div className="text-xs text-[var(--color-muted)]">
                              Policy #
                            </div>
                            <div className="font-medium text-[var(--color-text)] break-words">
                              {warranty?.policyNumber || "—"}
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : null}

                    {/* Attachments */}
                    {warranty?.attachments &&
                    warranty.attachments.length > 0 ? (
                      <div className="rounded-xl border border-black/10 bg-white p-3 sm:col-span-2">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-xs uppercase tracking-wide text-[var(--color-muted)]">
                            Attachments
                          </div>
                          <div className="text-xs text-[var(--color-muted)]">
                            {warranty.attachments.length} file(s)
                          </div>
                        </div>

                        <div className="mt-2 space-y-2">
                          {warranty.attachments.map((a) => {
                            const label =
                              a.label ||
                              kindLabelForAttachmentKind(a.kind) ||
                              "Attachment";

                            return (
                              <div
                                key={a.id}
                                className="flex items-start justify-between gap-3 rounded-lg border border-black/10 bg-white px-3 py-2"
                              >
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2">
                                    <FileText className="h-4 w-4 text-black/50" />
                                    <div className="text-sm font-semibold text-[var(--color-text)] break-words">
                                      {label}
                                    </div>
                                  </div>

                                  <div className="mt-1 text-xs text-[var(--color-muted)] break-words">
                                    {a.kind
                                      ? kindLabelForAttachmentKind(a.kind)
                                      : "Attachment"}
                                    {a.createdAt
                                      ? ` • ${fmtMaybeDate(a.createdAt)}`
                                      : ""}
                                  </div>

                                  <div className="mt-1 text-xs text-[var(--color-muted)] break-words">
                                    {a.url}
                                  </div>
                                </div>

                                {isValidHttpUrl(a.url) ? (
                                  <a
                                    href={a.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="print:hidden inline-flex shrink-0 items-center gap-1 rounded-lg border border-black/10 bg-white px-2 py-1 text-xs font-semibold text-[var(--color-text)] hover:bg-black/5"
                                  >
                                    <ExternalLink className="h-3.5 w-3.5" />
                                    Open
                                  </a>
                                ) : null}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="mt-2 flex items-center gap-2 text-sm text-[var(--color-muted)]">
                    <AlertCircle className="h-4 w-4" />
                    No warranty metadata saved yet.
                  </div>
                )}
              </div>
            </>
          )}

          {/* Notes */}
          {mode === "internal" ? (
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
                  (job.notes ?? []).map((n) => (
                    <div
                      key={n.id}
                      className="rounded-xl border border-black/10 bg-white p-3"
                    >
                      <div className="text-sm text-[var(--color-text)] whitespace-pre-wrap break-words">
                        {n.text || ""}
                      </div>
                      {n.createdAt ? (
                        <div className="mt-1 text-xs text-[var(--color-muted)]">
                          {fmtMaybeDate(n.createdAt)}
                        </div>
                      ) : null}
                    </div>
                  ))
                )}
              </div>
            </div>
          ) : (
            <div className="mt-6">
              <div className="text-sm font-semibold text-[var(--color-text)]">
                Warranty notes
              </div>
              <div className="mt-2">
                {warranty?.notes ? (
                  <div className="rounded-xl border border-black/10 bg-white p-3">
                    <div className="text-sm text-[var(--color-text)] whitespace-pre-wrap break-words">
                      {warranty.notes}
                    </div>
                  </div>
                ) : (
                  <div className="text-sm text-[var(--color-muted)]">
                    No warranty notes.
                  </div>
                )}
              </div>
            </div>
          )}

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
                Showing 12 of {photos.length} photos.
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
