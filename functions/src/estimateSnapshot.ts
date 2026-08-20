import { createHash } from "node:crypto";

export type EstimateSnapshot = Record<string, unknown>;

const SNAPSHOT_FIELDS = [
  "organizationId",
  "orgId",
  "jobId",
  "sourceLeadId",
  "customerId",
  "number",
  "documentType",
  "projectTitle",
  "scopeSummary",
  "issueDate",
  "validUntil",
  "customerSnapshot",
  "propertyAddressSnapshot",
  "organizationSnapshot",
  "roofMeasurements",
  "roofAreaSquareFeet",
  "roofSquares",
  "measurementsFinalized",
  "lineItems",
  "laborFeesSnapshot",
  "subtotalCents",
  "discountCents",
  "taxCents",
  "taxRatePercent",
  "totalCents",
  "depositCents",
  "paymentTerms",
  "warrantyText",
  "notes",
  "assumptions",
  "exclusions",
] as const;

function clonePlain(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value
      .map(clonePlain)
      .filter((item): item is Exclude<typeof item, undefined> => item !== undefined);
  }
  if (typeof value === "object") {
    const source = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      const cloned = clonePlain(source[key]);
      if (cloned !== undefined) result[key] = cloned;
    }
    return result;
  }
  return String(value);
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      result[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return result;
  }
  return value;
}

export function buildEstimateSnapshot(
  estimateId: string,
  estimate: Record<string, unknown>
): EstimateSnapshot {
  const snapshot: EstimateSnapshot = { id: estimateId };
  for (const field of SNAPSHOT_FIELDS) {
    const value = clonePlain(estimate[field]);
    if (value !== undefined) snapshot[field] = value;
  }
  snapshot.number = String(snapshot.number || "Estimate");
  snapshot.documentType = "estimate";
  snapshot.lineItems = Array.isArray(snapshot.lineItems) ? snapshot.lineItems : [];
  snapshot.assumptions = Array.isArray(snapshot.assumptions)
    ? snapshot.assumptions
    : [];
  snapshot.exclusions = Array.isArray(snapshot.exclusions)
    ? snapshot.exclusions
    : [];
  return snapshot;
}

export function estimateSnapshotHash(snapshot: EstimateSnapshot): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(snapshot)))
    .digest("hex");
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

export function publicEstimateFromSnapshot(
  estimateId: string,
  snapshot: EstimateSnapshot,
  version: number,
  status: string
): Record<string, unknown> {
  const publicLineItems = Array.isArray(snapshot.lineItems)
    ? snapshot.lineItems
        .filter((line) => {
          const record = asRecord(line);
          return record.customerVisible !== false && record.selected !== false;
        })
        .map((line) => {
          const record = asRecord(line);
          return {
            id: String(record.id || ""),
            category: String(record.category || "roofing_scope"),
            title: String(record.title || ""),
            customerDescription: String(record.customerDescription || ""),
            quantity: Number(record.quantity || 0),
            unit: String(record.unit || "LS"),
            unitPriceCents: Number(record.unitPriceCents || 0),
            lineTotalCents: Number(record.lineTotalCents || 0),
            discountCents: Number(record.discountCents || 0),
            pricingMode: String(record.pricingMode || "unit_price"),
            selectionType: String(record.selectionType || "base"),
            selected: true,
            customerVisible: true,
            taxable: Boolean(record.taxable),
            source: String(record.source || "manual"),
          };
        })
    : [];
  const laborFees = asRecord(snapshot.laborFeesSnapshot);
  const publicLaborFees = snapshot.laborFeesSnapshot
    ? {
        materialTotalCents: Number(laborFees.materialTotalCents || 0),
        laborCostCents: Number(laborFees.laborCostCents || 0),
        dumpsterFeeCents: Number(laborFees.dumpsterFeeCents || 0),
        roofLoadFeeCents: Number(laborFees.roofLoadFeeCents || 0),
        laborAndFeesTotalCents: Number(
          laborFees.laborAndFeesTotalCents || 0
        ),
      }
    : null;

  return {
    id: estimateId,
    organizationId: String(snapshot.organizationId || snapshot.orgId || ""),
    jobId: String(snapshot.jobId || ""),
    number: String(snapshot.number || "Estimate"),
    version,
    status,
    documentType: "estimate",
    projectTitle: String(snapshot.projectTitle || "Roofing project"),
    scopeSummary: String(snapshot.scopeSummary || ""),
    issueDate: snapshot.issueDate || null,
    validUntil: snapshot.validUntil || null,
    customerSnapshot: snapshot.customerSnapshot || {},
    propertyAddressSnapshot: snapshot.propertyAddressSnapshot || null,
    organizationSnapshot: snapshot.organizationSnapshot || {
      name: "Roger's Roofing",
    },
    roofAreaSquareFeet: Number(snapshot.roofAreaSquareFeet || 0),
    lineItems: publicLineItems,
    ...(publicLaborFees ? { laborFeesSnapshot: publicLaborFees } : {}),
    subtotalCents: Number(snapshot.subtotalCents || 0),
    discountCents: Number(snapshot.discountCents || 0),
    taxCents: Number(snapshot.taxCents || 0),
    taxRatePercent: Number(snapshot.taxRatePercent || 0),
    totalCents: Number(snapshot.totalCents || 0),
    depositCents: Number(snapshot.depositCents || 0),
    paymentTerms: String(snapshot.paymentTerms || ""),
    warrantyText: String(snapshot.warrantyText || ""),
    notes: String(snapshot.notes || ""),
    assumptions: Array.isArray(snapshot.assumptions)
      ? snapshot.assumptions.map(String)
      : [],
    exclusions: Array.isArray(snapshot.exclusions)
      ? snapshot.exclusions.map(String)
      : [],
  };
}
