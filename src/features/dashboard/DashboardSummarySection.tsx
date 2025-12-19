// src/features/dashboard/DashboardSummarySection.tsx
import type { Job, PayoutDoc } from "../../types/types";

interface DashboardSummarySectionProps {
  jobs: Job[];
  materialProgressJobs: Job[];
  readyForPunchJobs: Job[];
  payouts: PayoutDoc[];
}

function Card({
  label,
  value,
  className = "",
}: {
  label: string;
  value: number | string;
  className?: string;
}) {
  return (
    <div
      className={
        "rounded-xl bg-white/60 p-4 shadow-md border border-[var(--color-border)]/40 " +
        className
      }
    >
      <div className="text-xl font-semibold text-[var(--color-text)]">
        {value}
      </div>
      <div className="text-xs uppercase tracking-wide text-[var(--color-muted)]">
        {label}
      </div>
    </div>
  );
}

export default function DashboardSummarySection({
  jobs,
  materialProgressJobs,
  readyForPunchJobs,
  payouts,
}: DashboardSummarySectionProps) {
  const totalJobs = jobs.length;

  const pendingJobs = jobs.filter((j) => j.status === "pending").length;
  const completedJobs = jobs.filter((j) => j.status === "completed").length;

  const pendingPayouts = payouts.filter((p) => !p.paidAt).length;
  const paidPayouts = payouts.filter((p) => !!p.paidAt).length;

  return (
    <section className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      <Card label="Total Jobs" value={totalJobs} />
      <Card label="Pending Completion" value={pendingJobs} />
      <Card
        label="Scheduled / In Progress"
        value={materialProgressJobs.length}
        className="bg-sky-50"
      />
      <Card
        label="Ready for Punch"
        value={readyForPunchJobs.length}
        className="bg-emerald-50"
      />

      <Card label="Completed" value={completedJobs} className="bg-emerald-50" />
      <Card
        label="Pending Payouts"
        value={pendingPayouts}
        className="bg-white/60"
      />
      <Card label="Paid Payouts" value={paidPayouts} className="bg-white/60" />

      {/* Secondary “stage” indicators (these are super useful + already computed elsewhere) */}
      {/* If you want these instead of Active/Completed, swap cards above */}
      {/* <Card label="In Progress" value={materialProgressJobs.length} className="bg-sky-50" /> */}
      {/* <Card label="Ready for Punch" value={readyForPunchJobs.length} className="bg-emerald-50" /> */}
    </section>
  );
}
