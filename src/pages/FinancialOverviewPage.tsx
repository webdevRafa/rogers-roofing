// src/pages/FinancialOverviewPage.tsx
// A comprehensive financial overview page for Roger's Roofing.
// This page aggregates job earnings, expenses and payouts over
// configurable time ranges and visualises them with rich charts.

import { useEffect, useState, useMemo } from "react";
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { db } from "../firebase/firebaseConfig";
import type { Job, PayoutDoc, MaterialExpense } from "../types/types";
import { jobConverter } from "../types/types";
import { useOrg } from "../contexts/OrgContext";

import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  type ChartData,
  type ChartOptions,
  type TooltipItem,
} from "chart.js";
import { Line, Bar, Pie } from "react-chartjs-2";

// Register necessary Chart.js modules once for all charts
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend
);

// Convert Firestore/Date/number/string to milliseconds
function toMillis(x: unknown): number | null {
  if (x == null) return null;
  let dt: Date | null = null;
  // Firestore timestamps have a toDate() method
  if ((x as any)?.toDate) {
    try {
      dt = (x as any).toDate() as Date;
    } catch {
      /* ignore */
    }
  } else if (x instanceof Date) {
    dt = x;
  } else if (typeof x === "string" || typeof x === "number") {
    const candidate = new Date(x);
    if (!Number.isNaN(candidate.getTime())) dt = candidate;
  }
  return dt ? dt.getTime() : null;
}

// Helper to pick a string from a record using a list of keys
function pickString(obj: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim().length > 0) return v;
  }
  return "";
}

// Derive a payout's employee name (normalises snapshots stored as string/object)
function payoutEmployeeName(p: PayoutDoc): string {
  const snap: any = (p as any).employeeNameSnapshot;
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

// Supported time ranges for the overview page
type RangeOption = "6months" | "12months" | "ytd" | "all";

// Compute the start date corresponding to a range option
function getRangeStart(option: RangeOption): Date | null {
  const now = new Date();
  if (option === "6months") {
    // 6 months inclusive: go back 5 months from current month start
    return new Date(now.getFullYear(), now.getMonth() - 5, 1);
  }
  if (option === "12months") {
    // 12 months inclusive: go back 11 months from current month start
    return new Date(now.getFullYear(), now.getMonth() - 11, 1);
  }
  if (option === "ytd") {
    // Year to date: start at Jan 1
    return new Date(now.getFullYear(), 0, 1);
  }
  // 'all' means no filtering by date
  return null;
}

// Format a Date to a "Jan 2025" style label
function formatMonth(date: Date): string {
  return date.toLocaleDateString(undefined, {
    month: "short",
    year: "numeric",
  });
}

// Format currency helper
function formatCurrency(amountCents: number): string {
  return (amountCents / 100).toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
}

export default function FinancialOverviewPage() {
  const { orgId, loading: orgLoading } = useOrg();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [payouts, setPayouts] = useState<PayoutDoc[]>([]);
  const [rangeOption, setRangeOption] = useState<RangeOption>("6months");

  // Subscribe to jobs and payouts for the current organisation
  useEffect(() => {
    if (!orgId) return;
    // Query jobs by org and order by updatedAt for recency
    const jobsQuery = query(
      collection(db, "jobs").withConverter(jobConverter),
      where("orgId", "==", orgId),
      orderBy("updatedAt", "desc")
    );
    const unsubJobs = onSnapshot(jobsQuery, (snap) => {
      setJobs(snap.docs.map((d) => d.data()));
    });
    // Query payouts by org and order by creation date
    const payoutsQuery = query(
      collection(db, "payouts"),
      where("orgId", "==", orgId),
      orderBy("createdAt", "desc")
    );
    const unsubPayouts = onSnapshot(payoutsQuery, (snap) => {
      setPayouts(snap.docs.map((d) => d.data() as PayoutDoc));
    });
    return () => {
      unsubJobs();
      unsubPayouts();
    };
  }, [orgId]);

  // Determine the start date for filtering
  const rangeStart = useMemo(() => getRangeStart(rangeOption), [rangeOption]);
  const now = useMemo(() => new Date(), []);

  // Filter jobs based on the selected range
  const filteredJobs = useMemo(() => {
    if (!rangeStart) return jobs;
    const startMs = rangeStart.getTime();
    return jobs.filter((job) => {
      const ms = toMillis((job as any).updatedAt ?? job.createdAt);
      return ms != null && ms >= startMs;
    });
  }, [jobs, rangeStart]);

  // Filter payouts based on the selected range
  const filteredPayouts = useMemo(() => {
    if (!rangeStart) return payouts;
    const startMs = rangeStart.getTime();
    return payouts.filter((p) => {
      const ms = toMillis(p.createdAt);
      return ms != null && ms >= startMs;
    });
  }, [payouts, rangeStart]);

  // Aggregate summary metrics
  const {
    totalEarningsCents,
    totalPayoutsCents,
    totalMaterialsCents,
    totalNetProfitCents,
    averageProfitCents,
    pendingPayoutsCents,
    paidPayoutsCents,
  } = useMemo(() => {
    let earnings = 0;
    let payoutsSum = 0;
    let materialsSum = 0;
    let netProfit = 0;
    for (const job of filteredJobs) {
      earnings += job.earnings?.totalEarningsCents ?? 0;
      payoutsSum += job.expenses?.totalPayoutsCents ?? 0;
      materialsSum += job.expenses?.totalMaterialsCents ?? 0;
      netProfit += job.computed?.netProfitCents ?? 0;
    }
    // Sum payouts directly to compute pending vs paid across filtered range
    let pending = 0;
    let paid = 0;
    for (const p of filteredPayouts) {
      const amt = p.amountCents ?? 0;
      if (p.paidAt) paid += amt;
      else pending += amt;
    }
    const average =
      filteredJobs.length > 0 ? Math.round(netProfit / filteredJobs.length) : 0;
    return {
      totalEarningsCents: earnings,
      totalPayoutsCents: payoutsSum,
      totalMaterialsCents: materialsSum,
      totalNetProfitCents: netProfit,
      averageProfitCents: average,
      pendingPayoutsCents: pending,
      paidPayoutsCents: paid,
    };
  }, [filteredJobs, filteredPayouts]);

  // Monthly trend aggregation
  const {
    labels: trendLabels,
    earningsTotals,
    expenseTotals,
    netProfitTotals,
  } = useMemo(() => {
    // Determine month boundaries between rangeStart (inclusive) and now
    const months: string[] = [];
    const monthDates: Date[] = [];
    let startDate = rangeStart ? new Date(rangeStart) : null;
    // If no range start, look back up to 11 months (12 months total)
    if (!startDate) {
      startDate = new Date(now.getFullYear(), now.getMonth() - 11, 1);
    }
    if (startDate) {
      const startYear = startDate.getFullYear();
      const startMonth = startDate.getMonth();
      const endYear = now.getFullYear();
      const endMonth = now.getMonth();
      const count = (endYear - startYear) * 12 + (endMonth - startMonth);
      for (let i = 0; i <= count; i++) {
        const d = new Date(startYear, startMonth + i, 1);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
          2,
          "0"
        )}`;
        months.push(key);
        monthDates.push(d);
      }
    }
    const earnMap: Record<string, number> = {};
    const expMap: Record<string, number> = {};
    const netMap: Record<string, number> = {};
    months.forEach((m) => {
      earnMap[m] = 0;
      expMap[m] = 0;
      netMap[m] = 0;
    });
    for (const job of filteredJobs) {
      const ms = toMillis((job as any).updatedAt ?? job.createdAt);
      if (ms == null) continue;
      const dt = new Date(ms);
      const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(
        2,
        "0"
      )}`;
      if (earnMap[key] != null) {
        earnMap[key] += job.earnings?.totalEarningsCents ?? 0;
        expMap[key] +=
          (job.expenses?.totalPayoutsCents ?? 0) +
          (job.expenses?.totalMaterialsCents ?? 0);
        netMap[key] += job.computed?.netProfitCents ?? 0;
      }
    }
    const earningsTotals = months.map((m) => earnMap[m] / 100);
    const expenseTotals = months.map((m) => expMap[m] / 100);
    const netProfitTotals = months.map((m) => netMap[m] / 100);
    const labels = monthDates.map((d) => formatMonth(d));
    return { labels, earningsTotals, expenseTotals, netProfitTotals };
  }, [filteredJobs, rangeStart, now]);

  // Expense breakdown by category
  const { breakdownLabels, breakdownValues, breakdownColors } = useMemo(() => {
    const payoutCats: Record<string, number> = {};
    for (const p of filteredPayouts) {
      const cat = p.category ?? "other";
      payoutCats[cat] = (payoutCats[cat] || 0) + (p.amountCents ?? 0);
    }
    const materialCats: Record<string, number> = {};
    for (const job of filteredJobs) {
      const materials = job.expenses?.materials ?? [];
      for (const m of materials as MaterialExpense[]) {
        const ms = toMillis((m as any).purchasedAt ?? (m as any).createdAt);
        if (rangeStart) {
          if (ms == null || ms < rangeStart.getTime()) continue;
        }
        const cat = (m.category as string) ?? "materials";
        materialCats[cat] = (materialCats[cat] || 0) + (m.amountCents ?? 0);
      }
    }
    const labels: string[] = [];
    const values: number[] = [];
    const colors: string[] = [];
    // Colour palette roughly matching existing UI
    const palette = [
      "#8d6b3d",
      "#0e7490",
      "#f59e0b",
      "#10b981",
      "#6366f1",
      "#ec4899",
      "#14b8a6",
      "#f97316",
    ];
    let idx = 0;
    const pushCat = (name: string, cents: number) => {
      if (cents <= 0) return;
      labels.push(name);
      values.push(cents / 100);
      colors.push(palette[idx++ % palette.length]);
    };
    for (const [cat, cents] of Object.entries(payoutCats)) {
      const display = cat.charAt(0).toUpperCase() + cat.slice(1);
      pushCat(display + " (Payout)", cents);
    }
    for (const [cat, cents] of Object.entries(materialCats)) {
      const display = cat
        .replace(/([A-Z])/g, " $1")
        .replace(/^./, (s) => s.toUpperCase());
      pushCat(display + " (Mat.)", cents);
    }
    return {
      breakdownLabels: labels,
      breakdownValues: values,
      breakdownColors: colors,
    };
  }, [filteredPayouts, filteredJobs, rangeStart]);

  // Top jobs by net profit
  const { topJobLabels, topJobValues } = useMemo(() => {
    const list = filteredJobs
      .map((j) => {
        const profit = j.computed?.netProfitCents ?? 0;
        const label = (() => {
          const addr: any = j.address;
          if (typeof addr === "string") return addr;
          if (typeof addr === "object") {
            return (
              (addr.fullLine as string) ||
              (addr.line1 as string) ||
              `${addr.city ?? ""}, ${addr.state ?? ""}`
            );
          }
          return j.id;
        })();
        return { label, profit };
      })
      .sort((a, b) => b.profit - a.profit)
      .slice(0, 5);
    return {
      topJobLabels: list.map((x) => x.label),
      topJobValues: list.map((x) => x.profit / 100),
    };
  }, [filteredJobs]);

  // Top employees by total payout
  const { topEmployeeLabels, topEmployeeValues } = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const p of filteredPayouts) {
      const name = payoutEmployeeName(p) || "Unknown";
      totals[name] = (totals[name] || 0) + (p.amountCents ?? 0);
    }
    const list = Object.entries(totals)
      .map(([name, cents]) => ({ name, cents }))
      .sort((a, b) => b.cents - a.cents)
      .slice(0, 5);
    return {
      topEmployeeLabels: list.map((x) => x.name),
      topEmployeeValues: list.map((x) => x.cents / 100),
    };
  }, [filteredPayouts]);

  // Chart definitions
  const profitTrendData: ChartData<"line", number[], string> = {
    labels: trendLabels,
    datasets: [
      {
        label: "Earnings ($)",
        data: earningsTotals,
        borderColor: "#0e7490",
        backgroundColor: "rgba(14,116,144,0.2)",
        tension: 0.3,
      },
      {
        label: "Expenses ($)",
        data: expenseTotals,
        borderColor: "#8d6b3d",
        backgroundColor: "rgba(141,107,61,0.2)",
        tension: 0.3,
      },
      {
        label: "Net Profit ($)",
        data: netProfitTotals,
        borderColor: "#f59e0b",
        backgroundColor: "rgba(245,158,11,0.2)",
        tension: 0.3,
      },
    ],
  };
  const profitTrendOptions: ChartOptions<"line"> = {
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: "top",
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
            return `${label}: $${Number(value).toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}`;
          },
        },
      },
    },
    scales: {
      y: {
        beginAtZero: true,
        ticks: {
          callback: (value: any) => `$${value}`,
        },
      },
    },
  };

  const expenseBreakdownData: ChartData<"pie", number[], string> = {
    labels: breakdownLabels,
    datasets: [
      {
        data: breakdownValues,
        backgroundColor: breakdownColors,
        hoverOffset: 4,
      },
    ],
  };
  const expenseBreakdownOptions: ChartOptions<"pie"> = {
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: "bottom",
        labels: {
          font: { size: 11 },
          color: "#333",
        },
      },
      tooltip: {
        callbacks: {
          label: (context: TooltipItem<"pie">) => {
            const label = context.label ?? "";
            const value = context.parsed;
            return `${label}: $${Number(value).toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}`;
          },
        },
      },
    },
  };

  const topJobsData: ChartData<"bar", number[], string> = {
    labels: topJobLabels,
    datasets: [
      {
        label: "Net Profit ($)",
        data: topJobValues,
        backgroundColor: "#8d6b3d",
        borderColor: "#8d6b3d",
        borderWidth: 1,
      },
    ],
  };
  const topJobsOptions: ChartOptions<"bar"> = {
    indexAxis: "y",
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (context: TooltipItem<"bar">) => {
            const value = context.parsed.x;
            return `$${Number(value).toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}`;
          },
        },
      },
    },
    scales: {
      x: { beginAtZero: true },
    },
  };

  const topEmployeesData: ChartData<"bar", number[], string> = {
    labels: topEmployeeLabels,
    datasets: [
      {
        label: "Total Payout ($)",
        data: topEmployeeValues,
        backgroundColor: "#0e7490",
        borderColor: "#0e7490",
        borderWidth: 1,
      },
    ],
  };
  const topEmployeesOptions: ChartOptions<"bar"> = {
    indexAxis: "y",
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (context: TooltipItem<"bar">) => {
            const value = context.parsed.x;
            return `$${Number(value).toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}`;
          },
        },
      },
    },
    scales: {
      x: { beginAtZero: true },
    },
  };

  // Loading and guard states
  if (orgLoading) {
    return <div className="p-4">Loading financial overview…</div>;
  }
  if (!orgId) {
    return (
      <div className="p-8 text-red-600">
        You are not linked to an organization. Please contact your admin.
      </div>
    );
  }

  return (
    <div className="mx-auto w-full py-6 sm:py-10 md:px-4 grid grid-cols-1 gap-6 lg:grid-cols-12">
      {/* Summary cards */}
      <div className="lg:col-span-12">
        <section className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7">
          <div className="rounded-xl bg-white/60 p-4 shadow-md border border-[var(--color-border)]/40">
            <div className="text-xl font-semibold text-[var(--color-text)]">
              {formatCurrency(totalEarningsCents)}
            </div>
            <div className="text-xs uppercase tracking-wide text-[var(--color-muted)]">
              Total Earnings
            </div>
          </div>
          <div className="rounded-xl bg-white/60 p-4 shadow-md border border-[var(--color-border)]/40">
            <div className="text-xl font-semibold text-[var(--color-text)]">
              {formatCurrency(totalPayoutsCents)}
            </div>
            <div className="text-xs uppercase tracking-wide text-[var(--color-muted)]">
              Total Payouts
            </div>
          </div>
          <div className="rounded-xl bg-white/60 p-4 shadow-md border border-[var(--color-border)]/40">
            <div className="text-xl font-semibold text-[var(--color-text)]">
              {formatCurrency(totalMaterialsCents)}
            </div>
            <div className="text-xs uppercase tracking-wide text-[var(--color-muted)]">
              Total Materials
            </div>
          </div>
          <div className="rounded-xl bg-white/60 p-4 shadow-md border border-[var(--color-border)]/40">
            <div className="text-xl font-semibold text-[var(--color-text)]">
              {formatCurrency(totalNetProfitCents)}
            </div>
            <div className="text-xs uppercase tracking-wide text-[var(--color-muted)]">
              Net Profit
            </div>
          </div>
          <div className="rounded-xl bg-white/60 p-4 shadow-md border border-[var(--color-border)]/40">
            <div className="text-xl font-semibold text-[var(--color-text)]">
              {formatCurrency(averageProfitCents)}
            </div>
            <div className="text-xs uppercase tracking-wide text-[var(--color-muted)]">
              Avg. Profit/Job
            </div>
          </div>
          <div className="rounded-xl bg-white/60 p-4 shadow-md border border-[var(--color-border)]/40">
            <div className="text-xl font-semibold text-[var(--color-text)]">
              {formatCurrency(pendingPayoutsCents)}
            </div>
            <div className="text-xs uppercase tracking-wide text-[var(--color-muted)]">
              Pending Payouts
            </div>
          </div>
        </section>
      </div>
      {/* Range selector */}
      <div className="lg:col-span-12">
        <div className="flex flex-wrap items-center gap-2 text-sm mb-4">
          <span className="font-semibold text-[var(--color-text)]">
            Time Range:
          </span>
          {(
            [
              { label: "Last 6 months", value: "6months" },
              { label: "Last 12 months", value: "12months" },
              { label: "Year to date", value: "ytd" },
              { label: "All time", value: "all" },
            ] as { label: string; value: RangeOption }[]
          ).map((opt) => (
            <button
              key={opt.value}
              onClick={() => setRangeOption(opt.value)}
              className={
                "rounded-full px-3 py-1 border text-xs transition " +
                (rangeOption === opt.value
                  ? "bg-[var(--color-brown)] text-white"
                  : "bg-white/50 border-[var(--color-border)] text-[var(--color-text)] hover:bg-white")
              }
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
      {/* Profit trend chart section */}
      <div className="lg:col-span-12">
        <section className="rounded-2xl bg-white/60 hover:bg-white transition duration-300 ease-in-out p-4 sm:p-6 shadow-md hover:shadow-lg">
          <h2 className="mb-4 text-xl font-semibold text-[var(--color-text)]">
            Earnings, Expenses &amp; Profit Trend
          </h2>
          <div className="relative h-72 w-full">
            <Line data={profitTrendData} options={profitTrendOptions} />
          </div>
          <p className="mt-3 text-xs text-[var(--color-muted)]">
            This line chart shows how your total earnings, expenses and net
            profit have changed over the selected period.
          </p>
        </section>
      </div>

      {/* 3-up charts row */}
      <div className="lg:col-span-12 xl:col-span-4">
        <section className="rounded-2xl bg-white/60 hover:bg-white transition duration-300 ease-in-out p-4 sm:p-6 shadow-md hover:shadow-lg">
          <h2 className="mb-4 text-xl font-semibold text-[var(--color-text)]">
            Expense Breakdown
          </h2>
          <div className="relative h-64 w-full">
            {breakdownValues.length > 0 ? (
              <Pie
                data={expenseBreakdownData}
                options={expenseBreakdownOptions}
              />
            ) : (
              <div className="flex items-center justify-center h-full text-xs text-[var(--color-muted)]">
                No expenses in selected range
              </div>
            )}
          </div>
          <p className="mt-3 text-xs text-[var(--color-muted)]">
            Categories include payouts and materials. Hover slices to see
            values.
          </p>
        </section>
      </div>

      <div className="lg:col-span-12 xl:col-span-4">
        <section className="rounded-2xl bg-white/60 hover:bg-white transition duration-300 ease-in-out p-4 sm:p-6 shadow-md hover:shadow-lg">
          <h2 className="mb-4 text-xl font-semibold text-[var(--color-text)]">
            Top Jobs by Profit
          </h2>
          <div className="relative h-64 w-full">
            {topJobLabels.length > 0 ? (
              <Bar data={topJobsData} options={topJobsOptions} />
            ) : (
              <div className="flex items-center justify-center h-full text-xs text-[var(--color-muted)]">
                No jobs in selected range
              </div>
            )}
          </div>
        </section>
      </div>

      <div className="lg:col-span-12 xl:col-span-4">
        <section className="rounded-2xl bg-white/60 hover:bg-white transition duration-300 ease-in-out p-4 sm:p-6 shadow-md hover:shadow-lg">
          <h2 className="mb-4 text-xl font-semibold text-[var(--color-text)]">
            Top Employees by Payout
          </h2>
          <div className="relative h-64 w-full">
            {topEmployeeLabels.length > 0 ? (
              <Bar data={topEmployeesData} options={topEmployeesOptions} />
            ) : (
              <div className="flex items-center justify-center h-full text-xs text-[var(--color-muted)]">
                No payouts in selected range
              </div>
            )}
          </div>
        </section>
      </div>

      <div className="rounded-xl bg-white/60 p-4 shadow-md border border-[var(--color-border)]/40">
        <div className="text-xl font-semibold text-[var(--color-text)]">
          {formatCurrency(paidPayoutsCents)}
        </div>

        <div className="text-xs uppercase tracking-wide text-[var(--color-muted)]">
          Paid Payouts
        </div>

        <div className="mt-2">
          <div className="flex items-center justify-between text-[11px] text-[var(--color-muted)]">
            <span>Paid rate</span>
            <span className="font-semibold text-[var(--color-text)]">
              {totalPayoutsCents > 0
                ? Math.round((paidPayoutsCents / totalPayoutsCents) * 100)
                : 0}
              %
            </span>
          </div>

          <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-black/10">
            <div
              className="h-full rounded-full bg-[var(--color-brown)] transition-all"
              style={{
                width: `${
                  totalPayoutsCents > 0
                    ? Math.min(
                        100,
                        Math.round((paidPayoutsCents / totalPayoutsCents) * 100)
                      )
                    : 0
                }%`,
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
