// src/features/dashboard/DashboardFinancialOverviewSection.tsx
import { useMemo } from "react";
import type { Job, PayoutDoc } from "../../types/types";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  type ChartData,
  type ChartOptions,
  type TooltipItem,
} from "chart.js";
import { Line } from "react-chartjs-2";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
);

// Convert Firestore/Date/number/string to milliseconds
function toMillis(x: unknown): number | null {
  if (x == null) return null;
  let dt: Date | null = null;

  if ((x as any)?.toDate) {
    try {
      dt = (x as any).toDate() as Date;
    } catch {
      // ignore
    }
  } else if (x instanceof Date) {
    dt = x;
  } else if (typeof x === "string" || typeof x === "number") {
    const candidate = new Date(x);
    if (!Number.isNaN(candidate.getTime())) dt = candidate;
  }

  return dt ? dt.getTime() : null;
}

// Format a month like “Jan 2025”
function formatMonth(date: Date): string {
  return date.toLocaleDateString(undefined, {
    month: "short",
    year: "numeric",
  });
}

interface Props {
  jobs: Job[];
  payouts: PayoutDoc[];
}

/** Renders a dual-line chart summarising net profit vs total payouts */
export default function DashboardFinancialOverviewSection({
  jobs,
  payouts,
}: Props) {
  // Aggregate data for the past six months
  const { labels, netProfits, payoutTotals } = useMemo(() => {
    const now = new Date();
    const months: string[] = [];
    const monthDates: Date[] = [];

    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
        2,
        "0"
      )}`;
      months.push(key);
      monthDates.push(d);
    }

    const netMap: Record<string, number> = {};
    const payoutMap: Record<string, number> = {};
    months.forEach((m) => {
      netMap[m] = 0;
      payoutMap[m] = 0;
    });

    // Sum job net profit by month (using updatedAt or createdAt)
    jobs.forEach((job) => {
      const ms = toMillis(job.updatedAt ?? job.createdAt);
      if (ms == null) return;
      const dt = new Date(ms);
      const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(
        2,
        "0"
      )}`;

      const net = job.computed?.netProfitCents ?? 0;
      if (netMap[key] != null) netMap[key] += net;
    });

    // Sum payouts by month (using createdAt)
    payouts.forEach((p) => {
      const ms = toMillis(p.createdAt);
      if (ms == null) return;
      const dt = new Date(ms);
      const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(
        2,
        "0"
      )}`;

      const amt = p.amountCents ?? 0;
      if (payoutMap[key] != null) payoutMap[key] += amt;
    });

    const labels = monthDates.map(formatMonth);
    const netProfits = months.map((m) => netMap[m] / 100); // dollars
    const payoutTotals = months.map((m) => payoutMap[m] / 100); // dollars

    return { labels, netProfits, payoutTotals };
  }, [jobs, payouts]);

  // ✅ Strongly-type chart data so TS doesn't widen literals
  const chartData: ChartData<"line", number[], string> = {
    labels,
    datasets: [
      {
        label: "Net Profit ($)",
        data: netProfits,
        borderColor: "#8d6b3d",
        backgroundColor: "rgba(141,107,61,0.2)",
        tension: 0.3,
      },
      {
        label: "Payouts ($)",
        data: payoutTotals,
        borderColor: "#0e7490",
        backgroundColor: "rgba(14,116,144,0.2)",
        tension: 0.3,
      },
    ],
  };

  // ✅ Strongly-type chart options; legend.position stays a literal union ("top")
  const chartOptions: ChartOptions<"line"> = {
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: "top", // <-- now correctly typed (not widened to string)
        labels: {
          boxWidth: 12,
          font: { size: 12 },
          color: "#333",
        },
      },
      title: { display: false },
      tooltip: {
        callbacks: {
          label: (context: TooltipItem<"line">) => {
            const label = context.dataset.label ?? "";
            const value = context.parsed.y;
            return `${label}: $${Number(value).toFixed(2)}`;
          },
        },
      },
    },
    scales: {
      y: {
        beginAtZero: true,
        ticks: {
          callback: (value) => `$${value}`,
        },
      },
    },
  };

  return (
    <section className="mt-10 mb-40 rounded-2xl bg-white/60 hover:bg-white transition duration-300 ease-in-out p-4 sm:p-6 shadow-md hover:shadow-lg">
      <h2 className="mb-4 text-2xl font-semibold text-[var(--color-text)]">
        Financial Overview
      </h2>

      <div className="relative h-64 w-full">
        <Line data={chartData} options={chartOptions} />
      </div>

      <p className="mt-3 text-xs text-[var(--color-muted)]">
        This chart summarises your net profit versus total payouts over the last
        six months. Use it to spot trends and ensure your roofing business
        remains profitable.
      </p>
    </section>
  );
}
