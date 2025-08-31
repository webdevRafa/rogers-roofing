// src/components/JobListItem.tsx
import { Link } from "react-router-dom";
import type { Job } from "../types/types";
import { formatCurrency } from "../utils/money";

type Props = {
  job: Job;
};

export default function JobListItem({ job }: Props) {
  const last = job.updatedAt ?? job.createdAt ?? null;
  const net = job.computed?.netProfitCents ?? 0;
  return (
    <Link
      to={`/job/${job.id}`}
      className="block rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] hover:bg-[var(--color-card-hover)] py-2 px-4 transition-colors"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-base font-semibold text-[var(--color-text)]">
            {job.address?.fullLine}
          </div>
          <div className="text-sm text-[var(--color-muted)]">
            Last updated:{" "}
            {last
              ? new Date(
                  (last as any)?.toDate ? (last as any).toDate() : last
                ).toLocaleString()
              : "—"}
          </div>
          <div className="mt-1 inline-flex items-center gap-2 text-xs uppercase tracking-wide text-[var(--color-muted)]">
            <span className="rounded-full px-2 py-0.5 border border-white/20">
              {job.status}
            </span>
          </div>
        </div>
        <div className="text-right">
          <div className="text-sm text-[var(--color-muted)]">Net Profit</div>
          <div className="text-xl font-semibold font-poppins text-emerald-600">
            {formatCurrency(net)}
          </div>
        </div>
      </div>
    </Link>
  );
}
