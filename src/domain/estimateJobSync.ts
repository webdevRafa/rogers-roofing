import { calculateEstimateLaborFees } from "./estimateFees";
import { estimateLineItemsFromJobMaterials } from "./estimateMaterials";
import type {
  EstimateLineItem,
  EstimateRecord,
  EstimateStatus,
  JobMaterialActual,
} from "./roofing";
import type { Job, PayoutDoc } from "../types/types";

const LIVE_JOB_SOURCE_STATUSES = new Set<EstimateStatus>([
  "lead_received",
  "inspection_scheduled",
  "inspection_complete",
  "draft",
  "internal_review",
  "ready_to_send",
  "revising",
  "sent",
  "viewed",
]);

export function estimateUsesLiveJobSources(status: EstimateStatus) {
  return LIVE_JOB_SOURCE_STATUSES.has(status);
}

export function estimateMaterialTotalCents(lineItems: EstimateLineItem[]) {
  return lineItems.reduce((total, line) => {
    const included =
      line.pricingMode === "included" || line.pricingMode === "no_charge";
    return included ? total : total + Math.max(0, line.lineTotalCents);
  }, 0);
}

function safeCents(value: number | undefined) {
  return Number.isFinite(value) ? Math.max(0, Math.round(value || 0)) : 0;
}

function safePercent(value: number | undefined) {
  return Number.isFinite(value) ? Math.max(0, value || 0) : 0;
}

export function synchronizeEstimateFromJobSources(
  estimate: EstimateRecord,
  job: Job,
  materials: JobMaterialActual[],
  payouts: PayoutDoc[]
): EstimateRecord {
  const syncedMaterialLines = estimateLineItemsFromJobMaterials(materials);
  const lineItems =
    syncedMaterialLines.length > 0 ? syncedMaterialLines : estimate.lineItems;
  const materialTotalCents = estimateMaterialTotalCents(lineItems);
  const payoutTotalCents = payouts.reduce(
    (total, payout) => total + safeCents(payout.amountCents),
    0
  );
  const laborFeesSnapshot = calculateEstimateLaborFees(
    materialTotalCents,
    payoutTotalCents,
    job.estimateFees
  );
  const subtotalCents =
    materialTotalCents + laborFeesSnapshot.laborAndFeesTotalCents;
  const discountCents = Math.min(
    subtotalCents,
    safeCents(estimate.discountCents)
  );
  const taxableBaseCents = Math.max(0, subtotalCents - discountCents);
  const taxRatePercent = safePercent(estimate.taxRatePercent);
  const taxCents = Math.round(taxableBaseCents * (taxRatePercent / 100));
  const totalCents = taxableBaseCents + taxCents;
  const depositCents = Math.min(totalCents, safeCents(estimate.depositCents));
  const customerSnapshot = {
    name: job.customer?.name || estimate.customerSnapshot?.name || "",
    ...(job.customer?.email || estimate.customerSnapshot?.email
      ? { email: job.customer?.email || estimate.customerSnapshot?.email }
      : {}),
    ...(job.customer?.phone || estimate.customerSnapshot?.phone
      ? { phone: job.customer?.phone || estimate.customerSnapshot?.phone }
      : {}),
  };

  return {
    ...estimate,
    customerSnapshot,
    propertyAddressSnapshot:
      typeof job.address === "string"
        ? { fullLine: job.address, street: job.address, country: "US" }
        : job.address || estimate.propertyAddressSnapshot,
    lineItems,
    laborFeesSnapshot,
    roofMeasurements: job.roofMeasurements || estimate.roofMeasurements || [],
    roofAreaSquareFeet:
      job.roofAreaSquareFeet ?? estimate.roofAreaSquareFeet ?? 0,
    roofSquares: job.roofSquares ?? estimate.roofSquares ?? 0,
    measurementsFinalized:
      job.measurementsFinalized ?? estimate.measurementsFinalized ?? false,
    subtotalCents,
    discountCents,
    taxCents,
    taxRatePercent,
    totalCents,
    depositCents,
  };
}

export function estimateJobSyncFields(estimate: EstimateRecord) {
  return {
    customerSnapshot: estimate.customerSnapshot || {},
    propertyAddressSnapshot: estimate.propertyAddressSnapshot || null,
    lineItems: estimate.lineItems,
    laborFeesSnapshot: estimate.laborFeesSnapshot,
    roofMeasurements: estimate.roofMeasurements || [],
    roofAreaSquareFeet: estimate.roofAreaSquareFeet || 0,
    roofSquares: estimate.roofSquares || 0,
    measurementsFinalized: Boolean(estimate.measurementsFinalized),
    subtotalCents: estimate.subtotalCents,
    discountCents: estimate.discountCents,
    taxCents: estimate.taxCents,
    taxRatePercent: estimate.taxRatePercent || 0,
    totalCents: estimate.totalCents,
    depositCents: estimate.depositCents || 0,
  };
}

export function estimateJobSourcesAreCurrent(
  saved: EstimateRecord,
  synchronized: EstimateRecord
) {
  return (
    JSON.stringify(estimateJobSyncFields(saved)) ===
    JSON.stringify(estimateJobSyncFields(synchronized))
  );
}
