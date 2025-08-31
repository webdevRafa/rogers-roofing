// src/components/JobListItem.tsx
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import CountUp from "react-countup";
import type { Job } from "../types/types";

type Props = {
  job: Job;
};

// Easing & simple item variants (mirrors the style used on Job pages)
const EASE = [0.16, 1, 0.3, 1] as const;
const item = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
};

function MoneyCount({
  cents,
  className = "",
}: {
  cents: number;
  className?: string;
}) {
  const dollars = (cents ?? 0) / 100;
  return (
    <span className={className}>
      <CountUp
        key={cents}
        end={dollars}
        decimals={2}
        prefix="$"
        duration={0.6}
      />
    </span>
  );
}

const MotionLink = motion(Link);

export default function JobListItem({ job }: Props) {
  const last = job.updatedAt ?? job.createdAt ?? null;
  const net = job.computed?.netProfitCents ?? 0;

  return (
    <MotionLink
      to={`/job/${job.id}`}
      className="block rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] hover:bg-[var(--color-card-hover)] py-2 px-4 transition-colors"
      variants={item}
      initial="initial"
      animate="animate"
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.995 }}
      transition={{ duration: 0.25, ease: EASE }}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <motion.div
            className="text-base font-semibold text-[var(--color-text)]"
            variants={item}
          >
            {job.address?.fullLine}
          </motion.div>

          <motion.div
            className="text-sm text-[var(--color-muted)]"
            variants={item}
          >
            Last updated:{" "}
            {last
              ? new Date(
                  (last as any)?.toDate ? (last as any).toDate() : last
                ).toLocaleString()
              : "—"}
          </motion.div>

          <motion.div
            className="mt-1 inline-flex items-center gap-2 text-xs uppercase tracking-wide text-[var(--color-muted)]"
            variants={item}
          >
            <motion.span
              className="rounded-full px-2 py-0.5 border border-white/20"
              whileHover={{ scale: 1.04 }}
              transition={{ duration: 0.2, ease: EASE }}
            >
              {job.status}
            </motion.span>
          </motion.div>
        </div>

        <motion.div className="text-right" variants={item}>
          <div className="text-sm text-[var(--color-muted)]">Net Profit</div>
          <div className="text-xl font-semibold font-poppins text-emerald-600">
            <MoneyCount cents={net} />
          </div>
        </motion.div>
      </div>
    </MotionLink>
  );
}
