// src/utils/calc.ts
import type { Job, Payout, MaterialExpense, Earnings, Expenses } from "../types";
import { toCents } from "./money";

/** Recalculate cached totals & computed metrics on a Job */
export function recomputeJob(job: Job): Job {
  const payoutsCents = sumPayouts(job.expenses.payouts);
  const materialsCents = sumMaterials(job.expenses.materials);
  const totalExpensesCents = payoutsCents + materialsCents;
  const totalEarningsCents = job.earnings?.totalEarningsCents ?? 0;
  const netProfitCents = totalEarningsCents - totalExpensesCents;

  return {
    ...job,
    earnings: {
      currency: job.earnings?.currency ?? "USD",
      totalEarningsCents,
      entries: job.earnings?.entries ?? [],
    },
    expenses: {
      currency: job.expenses?.currency ?? "USD",
      totalPayoutsCents: payoutsCents,
      totalMaterialsCents: materialsCents,
      payouts: job.expenses?.payouts ?? [],
      materials: job.expenses?.materials ?? [],
    },
    computed: {
      totalExpensesCents,
      netProfitCents,
    },
  };
}

export function sumPayouts(payouts?: Payout[] | null) {
  return (payouts ?? []).reduce((acc, p) => acc + (p.amountCents ?? 0), 0);
}

export function sumMaterials(materials?: MaterialExpense[] | null) {
  return (materials ?? []).reduce((acc, m) => acc + (m.amountCents ?? 0), 0);
}

export function makeAddress(fullLine: string) {
  return { fullLine } as Job["address"];
}
