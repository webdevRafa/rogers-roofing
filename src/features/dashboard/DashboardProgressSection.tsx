import type { Dispatch, SetStateAction } from "react";
import { Link } from "react-router-dom";
import { motion, type MotionProps, type Variants } from "framer-motion";
import { ChevronDown } from "lucide-react";
import type { Job } from "../../types/types";

// ----- Animation helpers -----
const EASE = [0.16, 1, 0.3, 1] as const;

const fadeUp = (delay = 0): Partial<MotionProps> => ({
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.35, ease: EASE, delay },
});

const staggerParent: Variants = {
  initial: { opacity: 0 },
  animate: {
    opacity: 1,
    transition: { staggerChildren: 0.08, delayChildren: 0.02 },
  },
};

const item: Variants = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
};

// ----- Date utils -----
type FsTs = { toDate: () => Date };

function isFsTimestamp(val: unknown): val is FsTs {
  return typeof (val as FsTs)?.toDate === "function";
}

function toMillis(x: unknown): number | null {
  if (x == null) return null;
  if (x instanceof Date) return x.getTime();
  if (typeof x === "number") return x;
  if (typeof x === "string") {
    const d = new Date(x);
    return Number.isNaN(d.getTime()) ? null : d.getTime();
  }
  if (isFsTimestamp(x)) {
    const d = x.toDate();
    return Number.isNaN(d.getTime()) ? null : d.getTime();
  }
  return null;
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

// ----- Address + status helpers (mirrors DashboardPage) -----
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

type JobStatus = Job["status"];

function statusClasses(status: JobStatus) {
  switch (status) {
    case "active":
      return "bg-[var(--color-primary)]/15 text-[var(--color-primary)]";
    case "pending":
      return "bg-yellow-100 text-yellow-800";
    case "invoiced":
      return "bg-blue-100 text-blue-700";
    case "paid":
      return "bg-emerald-100 text-emerald-700";
    case "completed":
      return "bg-emerald-100 text-emerald-700";
    case "closed":
      return "bg-gray-200 text-gray-700";
    case "archived":
      return "bg-slate-200 text-slate-700";
    case "draft":
    default:
      return "bg-neutral-100 text-neutral-700";
  }
}

export interface DashboardProgressSectionProps {
  upcomingOpen: boolean;
  setUpcomingOpen: Dispatch<SetStateAction<boolean>>;
  materialProgressJobs: Job[];
  readyForPunchJobs: Job[];
}

export function DashboardProgressSection({
  upcomingOpen,
  setUpcomingOpen,
  materialProgressJobs,
  readyForPunchJobs,
}: DashboardProgressSectionProps) {
  return (
    <section className="mt-8 rounded-2xl bg-white/60 hover:bg-white transition duration-300 ease-in-out p-4 sm:p-6 shadow-md hover:shadow-lg">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div>
            <h2 className="text-xl sm:text-2xl font-semibold text-[var(--color-text)]">
              Active / Scheduled
            </h2>
          </div>
          <button
            type="button"
            onClick={() => setUpcomingOpen((v) => !v)}
            className="inline-flex max-w-[120px] items-center rounded-full border border-[var(--color-border)] bg-[var(--color-brown)] hover:bg-[var(--color-brown-hover)] px-3 py-1 text-xs font-medium text-white"
          >
            <ChevronDown
              className={`mr-1 h-4 w-4 transition-transform ${
                upcomingOpen ? "rotate-0" : "-rotate-90"
              }`}
            />
            <span className="hidden sm:inline">
              {upcomingOpen ? "Collapse" : "Expand"}
            </span>
            <span className="sm:hidden" />
          </button>
        </div>

        <div className="flex flex-wrap gap-2 text-[11px]">
          {materialProgressJobs.length > 0 && (
            <span className="inline-flex items-center rounded-full bg-sky-50 px-3 py-1 font-semibold text-sky-800 border border-sky-200">
              {materialProgressJobs.length} job
              {materialProgressJobs.length === 1 ? "" : "s"} in progress
            </span>
          )}
          {readyForPunchJobs.length > 0 && (
            <span className="inline-flex items-center rounded-full bg-emerald-50 px-3 py-1 font-semibold text-emerald-700 border border-emerald-200">
              {readyForPunchJobs.length} ready for punch
            </span>
          )}
        </div>
      </div>

      {upcomingOpen && (
        <div className="mt-4 grid gap-6 lg:grid-cols-2">
          {/* Progress tracker */}
          <motion.div {...fadeUp(0.05)}>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
              Active / Scheduled
            </h3>

            {materialProgressJobs.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[var(--color-border)] bg-white/60 px-4 py-3 text-xs text-[var(--color-muted)]">
                No jobs have felt or shingles scheduled yet. As you update each
                job, they&apos;ll show up here.
              </div>
            ) : (
              <motion.div
                className="max-h-[360px] overflow-y-auto section-scroll space-y-3"
                variants={staggerParent}
                initial="initial"
                animate="animate"
              >
                {materialProgressJobs.map((job) => {
                  const a = addr(job.address);

                  const feltSch = toMillis(
                    (job as any).feltScheduledFor ?? null
                  );
                  const feltDone = toMillis(
                    (job as any).feltCompletedAt ?? null
                  );
                  const shinglesSch = toMillis(
                    (job as any).shinglesScheduledFor ?? null
                  );
                  const shinglesDone = toMillis(
                    (job as any).shinglesCompletedAt ?? null
                  );

                  const fmt = (ms: number | null) =>
                    ms == null ? "" : new Date(ms).toLocaleDateString();

                  const feltLabel = feltDone
                    ? `Completed ${fmt(feltDone)}`
                    : feltSch
                    ? `Scheduled ${fmt(feltSch)}`
                    : "Not scheduled";

                  const shinglesLabel = shinglesDone
                    ? `Completed ${fmt(shinglesDone)}`
                    : shinglesSch
                    ? `Scheduled ${fmt(shinglesSch)}`
                    : "Not scheduled";

                  const pillClass = (
                    done: number | null,
                    scheduled: number | null
                  ) =>
                    done != null
                      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                      : scheduled != null
                      ? "bg-sky-50 text-sky-800 border-sky-200"
                      : "bg-slate-50 text-slate-700 border-slate-200";

                  return (
                    <motion.div
                      key={job.id}
                      variants={item}
                      className="flex flex-col gap-2 rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)]/80 px-3 py-2 sm:gap-3 sm:py-3"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="truncate text-sm font-semibold text-[var(--color-text)]">
                          {a.display || "—"}
                        </div>
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] opacity-60 font-semibold uppercase ${statusClasses(
                            job.status
                          )}`}
                        >
                          {job.status}
                        </span>
                      </div>

                      <div className="flex flex-wrap gap-2 text-[11px]">
                        <span
                          className={
                            "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 " +
                            pillClass(feltDone, feltSch)
                          }
                        >
                          <span className="font-semibold uppercase">
                            Dry in
                          </span>
                          <span className="truncate max-w-[140px]">
                            {feltLabel}
                          </span>
                        </span>
                        <span
                          className={
                            "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 " +
                            pillClass(shinglesDone, shinglesSch)
                          }
                        >
                          <span className="font-semibold uppercase">
                            Shingles
                          </span>
                          <span className="truncate max-w-[140px]">
                            {shinglesLabel}
                          </span>
                        </span>
                      </div>

                      <div className="flex justify-between items-center">
                        <div className="text-[11px] text-[var(--color-muted)]">
                          Last updated {fmtDateTime(job.updatedAt)}
                        </div>
                        <Link
                          to={`/job/${job.id}`}
                          className="inline-block rounded-lg border border-[var(--color-border)] px-3 py-1 text-[11px] text-[var(--color-text)] hover:bg-[var(--color-card-hover)]"
                        >
                          View job
                        </Link>
                      </div>
                    </motion.div>
                  );
                })}
              </motion.div>
            )}
          </motion.div>

          {/* Ready for punch */}
          <motion.div {...fadeUp(0.12)}>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
              Ready for punch
            </h3>

            {readyForPunchJobs.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[var(--color-border)] bg-white/60 px-4 py-3 text-xs text-[var(--color-muted)]">
                Once both felt and shingles are marked completed on a job, it
                will appear here as ready to be punched.
              </div>
            ) : (
              <motion.div
                className="max-h-[360px] overflow-y-auto section-scroll space-y-3"
                variants={staggerParent}
                initial="initial"
                animate="animate"
              >
                {readyForPunchJobs.map((job) => {
                  const a = addr(job.address);

                  const feltDone = toMillis(
                    (job as any).feltCompletedAt ?? null
                  );
                  const shinglesDone = toMillis(
                    (job as any).shinglesCompletedAt ?? null
                  );
                  const lastStage = Math.max(feltDone ?? 0, shinglesDone ?? 0);
                  const readySince =
                    lastStage > 0
                      ? new Date(lastStage).toLocaleDateString()
                      : null;
                  const punchMs = toMillis(
                    (job as any).punchScheduledFor ?? null
                  );
                  const punchDate =
                    punchMs != null
                      ? new Date(punchMs).toLocaleDateString()
                      : null;

                  return (
                    <motion.div
                      key={job.id}
                      variants={item}
                      className="flex flex-col gap-2 rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)]/80 px-3 py-2 sm:gap-3 sm:py-3"
                    >
                      <div className="flex flex-wrap items-center gap-2 justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="truncate text-sm font-semibold text-[var(--color-text)]">
                              {a.display || "—"}
                            </div>
                            <span
                              className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] opacity-60 font-semibold uppercase ${statusClasses(
                                job.status
                              )}`}
                            >
                              {job.status}
                            </span>
                          </div>
                          {readySince && (
                            <div className="mt-0.5 text-[11px] text-[var(--color-muted)]">
                              Ready since {readySince}
                            </div>
                          )}
                        </div>

                        {punchDate && (
                          <div className="flex-1 text-center text-[11px] text-[var(--color-muted)]">
                            Scheduled for {punchDate}
                          </div>
                        )}

                        <div className="flex flex-col gap-1 text-[11px]">
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700 border border-emerald-200">
                            <span className="font-semibold uppercase">
                              DRY IN
                            </span>
                            <span>Completed</span>
                          </span>
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700 border border-emerald-200">
                            <span className="font-semibold uppercase">
                              Shingles
                            </span>
                            <span>Completed</span>
                          </span>
                        </div>
                      </div>

                      <div className="flex justify-end">
                        <Link
                          to={`/job/${job.id}`}
                          className="inline-block rounded-lg border border-[var(--color-border)] px-3 py-1 text-[11px] text-[var(--color-text)] hover:bg-[var(--color-card-hover)]"
                        >
                          View job
                        </Link>
                      </div>
                    </motion.div>
                  );
                })}
              </motion.div>
            )}
          </motion.div>
        </div>
      )}
    </section>
  );
}
