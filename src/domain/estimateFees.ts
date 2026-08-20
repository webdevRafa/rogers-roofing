import type { EstimateLaborFeesSnapshot } from "./roofing";
import type { JobEstimateFees } from "../types/types";

export type CalculatedEstimateLaborFees = EstimateLaborFeesSnapshot & {
  payoutTotalCents: number;
  overheadPercent: number;
  overheadAmountCents: number;
};

function safeCents(value: number | undefined) {
  return Number.isFinite(value) ? Math.max(0, Math.round(value || 0)) : 0;
}

function safePercent(value: number | undefined) {
  return Number.isFinite(value) ? Math.max(0, value || 0) : 0;
}

export function calculateEstimateLaborFees(
  materialTotalCents: number,
  payoutTotalCents: number,
  fees?: JobEstimateFees | null
): CalculatedEstimateLaborFees {
  const materials = safeCents(materialTotalCents);
  const payouts = safeCents(payoutTotalCents);
  const overheadPercent = safePercent(fees?.overheadPercent);
  const overheadAmountCents = Math.round(
    (materials + payouts) * (overheadPercent / 100)
  );
  const laborCostCents = payouts + overheadAmountCents;
  const dumpsterFeeCents = safeCents(fees?.dumpsterFeeCents);
  const roofLoadFeeCents = safeCents(fees?.roofLoadFeeCents);

  return {
    materialTotalCents: materials,
    payoutTotalCents: payouts,
    overheadPercent,
    overheadAmountCents,
    laborCostCents,
    dumpsterFeeCents,
    roofLoadFeeCents,
    laborAndFeesTotalCents:
      laborCostCents + dumpsterFeeCents + roofLoadFeeCents,
  };
}
