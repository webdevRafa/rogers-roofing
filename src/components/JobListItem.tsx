// src/components/JobListItem.tsx
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import CountUp from "react-countup";
import type { Job, JobStatus } from "../types/types";

type Props = {
  job: Job;
};

// Easing & simple item variants (mirrors the style used on Job pages)
const EASE = [0.16, 1, 0.3, 1] as const;
const item = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
};

function statusPillClasses(status: JobStatus) {
  switch (status) {
    case "active":
      return "bg-[var(--color-primary)]/15 text-[var(--color-primary)]";
    case "pending":
      return "bg-yellow-100 text-yellow-800";
    case "invoiced":
      return "bg-blue-100 text-blue-700";
    case "paid":
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

function MoneyCount({
  cents,
  className = "text-sm",
}: {
  cents: number;
  className?: string;
}) {
  const dollars = (cents ?? 0) / 100;
  return (
    <span className={className}>
      <CountUp key={cents} end={dollars} decimals={2} prefix="$" duration={0.6} />
    </span>
  );
}

const MotionLink = motion(Link);

// ---- timestamp helpers (no `any`) ----
type FsTimestampLike = { toDate: () => Date };
function isFsTimestamp(x: unknown): x is FsTimestampLike {
  return typeof (x as FsTimestampLike)?.toDate === "function";
}
function toMillis(x: unknown): number | null {
  if (x == null) return null;
  let d: Date | null = null;
  if (isFsTimestamp(x)) d = x.toDate();
  else if (x instanceof Date) d = x;
  else if (typeof x === "string" || typeof x === "number") {
    const parsed = new Date(x);
    if (!Number.isNaN(parsed.getTime())) d = parsed;
  }
  return d ? d.getTime() : null;
}
function fmtDateTime(x: unknown): string {
  const ms = toMillis(x);
  return ms == null ? "—" : new Date(ms).toLocaleString();
}

export default function JobListItem({ job }: Props) {
  const last = job.updatedAt ?? job.createdAt ?? null;
  const net = job.computed?.netProfitCents ?? 0;

  return (
    <MotionLink
      to={`/job/${job.id}`}
      className="block rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] hover:bg-[var(--color-accent)]/3 py-2 px-4 transition-colors"
      variants={item}
      initial="initial"
      animate="animate"
      whileHover={{ y: -0.5 }}
      whileTap={{ scale: 0.995 }}
      transition={{ duration: 0.25, ease: EASE }}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <motion.div
            className="text-sm font-semibold text-[var(--color-text)]"
            variants={item}
          >
            {job.address?.fullLine}
          </motion.div>

          <motion.div
            className="text-xs text-[var(--color-muted)]/70"
            variants={item}
          >
            Last updated: {fmtDateTime(last)}
          </motion.div>

          <motion.div
            className="mt-1 inline-flex items-center gap-2 text-xs uppercase tracking-wide text-[var(--color-muted)]"
            variants={item}
          >
            <motion.span
              className="rounded-full text-xs px-1 py-0.5 border border-white/20"
              whileHover={{ scale: 1.04 }}
              transition={{ duration: 0.2, ease: EASE }}
            >
              <span
                className={`text-xs lowercase px-2 py-0.5 rounded-md ${statusPillClasses(
                  job.status as JobStatus
                )}`}
              >
                {job.status}
              </span>
            </motion.span>

            {/* persisted summary if present */}
            {job.pricing && (
              <span className="ml-1 text-xs text-[var(--color-muted)] whitespace-nowrap">
                {job.pricing.sqft.toLocaleString()} sq.ft @ ${job.pricing.ratePerSqFt}
              </span>
            )}
          </motion.div>
        </div>

        <motion.div className="text-right" variants={item}>
          <div className="text-xs text-[var(--color-muted)]">Net Revenue</div>
          <div className="text-xl font-semibold font-poppins text-emerald-600">
            <MoneyCount cents={net} />
          </div>
        </motion.div>
      </div>
    </MotionLink>
  );
}
