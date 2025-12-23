import { type Dispatch, type SetStateAction } from "react";
import { motion } from "framer-motion";
import { ChevronDown } from "lucide-react";
import type { PayoutDoc } from "../../types/types";
import type { Job } from "../../types/types";

// Same payout filter union as DashboardPage
export type PayoutFilter = "all" | "pending" | "paid";

// ---- Helpers (copied from DashboardPage) ----

// ---- Animation helpers ----
const EASE = [0.16, 1, 0.3, 1] as const;

const fadeUp = (delay = 0) => ({
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.35, ease: EASE, delay },
});

const staggerParent = {
  initial: { opacity: 0 },
  animate: {
    opacity: 1,
    transition: { staggerChildren: 0.04, delayChildren: 0.05 },
  },
};

const item = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
};

// Simple money formatter
function money(cents: number | null | undefined): string {
  const v = typeof cents === "number" ? cents : 0;
  return (v / 100).toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
  });
}

function isFsTimestamp(val: unknown): val is { toDate: () => Date } {
  return typeof (val as { toDate?: () => Date })?.toDate === "function";
}
function toMillis(x: unknown): number | null {
  if (x == null) return null;
  let dt: Date | null = null;
  if (isFsTimestamp(x)) dt = x.toDate();
  else if (x instanceof Date) dt = x;
  else if (typeof x === "string" || typeof x === "number") {
    const candidate = new Date(x);
    if (!Number.isNaN(candidate.getTime())) dt = candidate;
  }
  return dt ? dt.getTime() : null;
}
function fmtDateTime(x: unknown): string {
  const ms = toMillis(x);
  return ms == null
    ? "—"
    : new Date(ms).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
}

// Address helpers & employee name snapshot
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
function payoutEmployeeName(p: PayoutDoc): string {
  const snap = (p as any).employeeNameSnapshot;
  if (!snap) return "";
  if (typeof snap === "string") return snap;

  if (typeof snap === "object") {
    return pickString(snap as Record<string, unknown>, [
      "name",
      "fullName",
      "displayName",
    ]);
  }

  return "";
}

// ---- Props ----
export interface DashboardPayoutsSectionProps {
  payoutsOpen: boolean;
  setPayoutsOpen: Dispatch<SetStateAction<boolean>>;

  payoutSearch: string;
  setPayoutSearch: Dispatch<SetStateAction<string>>;

  payoutFilter: PayoutFilter;
  setPayoutFilter: Dispatch<SetStateAction<PayoutFilter>>;

  payoutsLoading: boolean;
  payoutsError: string | null;

  pagedPayouts: PayoutDoc[];
  filteredPayoutsCount: number;

  payoutsPage: number;
  payoutsTotalPages: number;
  setPayoutsPage: Dispatch<SetStateAction<number>>;
  PAYOUTS_PER_PAGE: number;

  selectedPayoutIds: string[];
  selectedEmployeeIds: string[];
  canCreateStub: boolean;

  togglePayoutSelected: (id: string) => void;
  clearSelectedPayouts: () => void;

  onOpenPayTechnician: () => void;

  setStubOpen: Dispatch<SetStateAction<boolean>>;

  onViewJob: (jobId: string) => void;
}

export function DashboardPayoutsSection({
  payoutsOpen,
  setPayoutsOpen,
  payoutSearch,
  setPayoutSearch,
  payoutFilter,
  setPayoutFilter,
  payoutsLoading,
  payoutsError,
  pagedPayouts,
  filteredPayoutsCount,
  payoutsPage,
  payoutsTotalPages,
  onOpenPayTechnician,
  setPayoutsPage,
  PAYOUTS_PER_PAGE,
  selectedPayoutIds,
  selectedEmployeeIds,
  canCreateStub,
  togglePayoutSelected,
  clearSelectedPayouts,
  setStubOpen,
  onViewJob,
}: DashboardPayoutsSectionProps) {
  return (
    <motion.section
      className="mt-10 mb-40 rounded-2xl bg-white/60 hover:bg-white transition duration-300 ease-in-out p-4 sm:p-6 shadow-md hover:shadow-lg"
      {...fadeUp(0.08)}
    >
      {/* Header + controls */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <div>
            <div className="flex gap-5">
              <h2 className="text-2xl font-semibold text-[var(--color-text)]">
                Payouts
              </h2>
              <button
                type="button"
                onClick={() => setPayoutsOpen((v) => !v)}
                className="ml-1 inline-flex items-center text-xs  border border-[var(--color-border)] bg-[var(--color-brown-hover)] hover:bg-[var(--color-brown)] cursor-pointer transition duration-300 ease-in-out px-2 py-0 text-white "
              >
                <ChevronDown
                  className={`h-4 w-4 transition-transform ${
                    payoutsOpen ? "rotate-0" : "-rotate-90"
                  }`}
                />
                <span className="ml-1 hidden sm:inline">
                  {payoutsOpen ? "Collapse" : "Expand"}
                </span>
              </button>
            </div>

            <p className="mt-3 text-xs text-[var(--color-muted)]">
              View payouts across all employees. Use the Pending tab to select
              payouts, generate a stub, and mark them as paid.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            value={payoutSearch}
            onChange={(e) => setPayoutSearch(e.target.value)}
            placeholder="Search by address or employee…"
            className="w-full sm:w-72 max-w-[200px] rounded-lg border border-[var(--color-border)] bg-white/80 px-3 py-1.5 text-sm text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
          />
          <button
            type="button"
            onClick={onOpenPayTechnician}
            className="rounded-lg bg-cyan-700 hover:bg-cyan-600 transition duration-300 ease-in-out px-3 py-2 text-xs font-semibold w-[100px] text-white"
          >
            Pay tech
          </button>

          <div className="inline-flex rounded-full border border-[var(--color-border)] bg-white/80 p-1 text-xs">
            {(["all", "pending", "paid"] as PayoutFilter[]).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setPayoutFilter(f)}
                className={
                  "px-3 py-1 rounded-full capitalize " +
                  (payoutFilter === f
                    ? "bg-cyan-800 text-white"
                    : "text-[var(--color-text)] hover:bg-[var(--color-card-hover)]")
                }
              >
                {f}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Collapsible content */}
      {payoutsOpen && (
        <div className="mt-2 relative overflow-auto section-scroll max-h-[420px]">
          {/* Inner content spacing/stack */}
          <div className="space-y-3">
            {/* Create stub CTA (pending only, single employee only) */}
            {payoutFilter === "pending" && selectedPayoutIds.length > 0 && (
              <div className="bg-white sticky top-0 z-20 mb-1 flex flex-col items-end gap-1 sm:flex-row sm:items-center sm:justify-between">
                {selectedEmployeeIds.length > 1 && (
                  <p className="text-xs text-red-700">
                    Please select payouts for a single employee to create a
                    stub.
                  </p>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  {canCreateStub && (
                    <button
                      type="button"
                      onClick={() => setStubOpen(true)}
                      className="rounded-lg bg-emerald-800 hover:bg-emerald-700 transition duration-300 ease-in-out px-3 py-1.5 text-xs font-semibold text-white"
                    >
                      Create stub ({selectedPayoutIds.length})
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={clearSelectedPayouts}
                    className="rounded-lg border border-[var(--color-border)] bg-[var(--color-primary-600)] hover:bg-[var(--color-primary)] px-3 py-1.5 text-xs font-medium text-white "
                  >
                    Clear all
                  </button>
                </div>
              </div>
            )}

            {/* States */}
            {payoutsLoading && (
              <p className="text-sm text-[var(--color-muted)]">
                Loading payouts…
              </p>
            )}
            {payoutsError && (
              <p className="text-sm text-red-600">{payoutsError}</p>
            )}
            {!payoutsLoading && !payoutsError && pagedPayouts.length === 0 && (
              <p className="text-sm text-[var(--color-muted)]">
                No payouts match the current filters.
              </p>
            )}

            {/* List */}
            {!payoutsLoading && !payoutsError && pagedPayouts.length > 0 && (
              <motion.ul
                className="divide-y divide-[var(--color-border)] rounded-xl bg-white/70"
                variants={staggerParent}
                initial="initial"
                animate="animate"
              >
                {pagedPayouts.map((p) => {
                  const a = addr((p as any).jobAddressSnapshot as any);
                  const employeeName = payoutEmployeeName(p);
                  const isPending = !p.paidAt;
                  const isSelected = selectedPayoutIds.includes(p.id);
                  const amountCents = (p as any).amountCents ?? 0;
                  const jobId = (p as any).jobId as string | undefined;

                  const sqft = p.sqft;
                  const ratePerSqFt = p.ratePerSqFt;
                  const category = p.category;

                  const hasSqft =
                    typeof sqft === "number" && !Number.isNaN(sqft);
                  const hasRate =
                    typeof ratePerSqFt === "number" &&
                    !Number.isNaN(ratePerSqFt);

                  const categoryLabel =
                    category === "shingles"
                      ? "Shingles labor"
                      : category === "felt"
                      ? "Felt labor"
                      : category === "technician"
                      ? "Technician"
                      : undefined;

                  return (
                    <motion.li
                      key={p.id}
                      variants={item}
                      className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div>
                        <div className="text-sm font-medium text-[var(--color-text)]">
                          {employeeName || "Unknown employee"}
                        </div>

                        <div className="text-xs text-[var(--color-muted)]">
                          {a.display || "—"}
                        </div>

                        {(a.city || a.state || a.zip) && (
                          <div className="text-[11px] text-[var(--color-muted)]">
                            {[a.city, a.state, a.zip]
                              .filter(Boolean)
                              .join(", ")}
                          </div>
                        )}

                        {(categoryLabel || hasSqft || hasRate) && (
                          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[var(--color-muted)]">
                            {categoryLabel && (
                              <span className="inline-flex items-center rounded-full bg-[var(--color-primary)]/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-primary)]">
                                {categoryLabel}
                              </span>
                            )}

                            {hasSqft && (
                              <span>{sqft!.toLocaleString()} sq ft</span>
                            )}
                            {hasSqft && hasRate && <span>•</span>}
                            {hasRate && (
                              <span>
                                @{" "}
                                {ratePerSqFt!.toLocaleString(undefined, {
                                  style: "currency",
                                  currency: "USD",
                                })}
                                /sq ft
                              </span>
                            )}
                          </div>
                        )}

                        <div className="mt-1 text-[11px] text-[var(--color-muted)]">
                          Created {fmtDateTime(p.createdAt)}{" "}
                          {p.paidAt
                            ? `• Paid ${fmtDateTime(p.paidAt)}`
                            : "• Pending"}
                        </div>
                      </div>

                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <div className="text-[11px] text-[var(--color-muted)]">
                            Amount
                          </div>
                          <div className="text-sm font-semibold text-[var(--color-text)]">
                            {money(amountCents)}
                          </div>
                        </div>

                        {jobId && (
                          <button
                            type="button"
                            onClick={() => onViewJob(jobId)}
                            className="rounded-md border border-[var(--color-border)] px-3 py-1 text-[11px] text-[var(--color-text)] hover:bg-[var(--color-card-hover)]"
                          >
                            View Job
                          </button>
                        )}

                        {isPending ? (
                          <span className="rounded-full bg-yellow-100 px-2 py-1 text-[10px] font-semibold uppercase text-yellow-800">
                            Pending
                          </span>
                        ) : (
                          <span className="rounded-full bg-emerald-100 px-2 py-1 text-[10px] font-semibold uppercase text-emerald-700">
                            Paid
                          </span>
                        )}

                        {payoutFilter === "pending" && (
                          <label className="flex items-center gap-2 text-xs text-[var(--color-muted)]">
                            <input
                              type="checkbox"
                              className="h-4 w-4 rounded border-[var(--color-border)] text-[var(--color-primary)] focus:ring-[var(--color-accent)]"
                              checked={isSelected}
                              onChange={() => togglePayoutSelected(p.id)}
                            />
                            Select
                          </label>
                        )}
                      </div>
                    </motion.li>
                  );
                })}
              </motion.ul>
            )}

            {/* Spacer so last item can scroll above sticky footer */}
            <div aria-hidden className="h-12" />
          </div>

          {/* Sticky pagination footer (always visible) */}
          {filteredPayoutsCount > 0 && (
            <div className="sticky bottom-[-1px] z-30 flex items-center justify-between gap-3 border-t border-[var(--color-border)]/40 bg-white/95 px-4 py-2 backdrop-blur text-xs text-[var(--color-muted)]">
              <span>
                Showing{" "}
                {filteredPayoutsCount === 0
                  ? 0
                  : (payoutsPage - 1) * PAYOUTS_PER_PAGE + 1}{" "}
                –{" "}
                {Math.min(payoutsPage * PAYOUTS_PER_PAGE, filteredPayoutsCount)}{" "}
                of {filteredPayoutsCount} payouts
              </span>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={payoutsPage === 1}
                  onClick={() => setPayoutsPage((p) => Math.max(1, p - 1))}
                  className="rounded border border-[var(--color-border)] px-2 py-1 disabled:opacity-40"
                >
                  Prev
                </button>
                <span>
                  Page {payoutsPage} / {payoutsTotalPages}
                </span>
                <button
                  type="button"
                  disabled={payoutsPage === payoutsTotalPages}
                  onClick={() =>
                    setPayoutsPage((p) => Math.min(payoutsTotalPages, p + 1))
                  }
                  className="rounded border border-[var(--color-border)] px-2 py-1 disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </motion.section>
  );
}
