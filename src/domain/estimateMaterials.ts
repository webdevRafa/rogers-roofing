import {
  getRoofingMaterialDefinition,
  ROOFING_MATERIAL_DEFINITIONS,
} from "./materials";
import type { EstimateLineItem, JobMaterialActual, RoofingUnit } from "./roofing";

function safeQuantity(value: number) {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function customerQuantity(
  quantity: number,
  unit: RoofingUnit
): { quantity: number; unit: RoofingUnit } {
  if (quantity <= 0) {
    return { quantity: 1, unit: "LS" };
  }
  if (unit === "SQ") {
    return { quantity: quantity * 100, unit: "SF" };
  }
  return { quantity, unit };
}

function lineDescription(material: JobMaterialActual) {
  return [
    material.manufacturerSnapshot,
    material.productSnapshot,
    material.colorSnapshot,
  ]
    .map((value) => value?.trim())
    .filter((value, index, values): value is string =>
      Boolean(value) && values.indexOf(value) === index
    )
    .join(" · ");
}

/**
 * Converts internal job takeoff/cost records into a customer-facing estimate
 * snapshot. Roofing SQ is converted to square feet so customers never need to
 * interpret contractor shorthand.
 */
export function estimateLineItemsFromJobMaterials(
  materials: JobMaterialActual[]
): EstimateLineItem[] {
  const materialOrder = new Map(
    ROOFING_MATERIAL_DEFINITIONS.map((definition, index) => [
      definition.value,
      index,
    ])
  );
  const sortedMaterials = [...materials].sort((a, b) => {
    const aOrder = a.materialType
      ? materialOrder.get(a.materialType) ?? Number.MAX_SAFE_INTEGER
      : Number.MAX_SAFE_INTEGER;
    const bOrder = b.materialType
      ? materialOrder.get(b.materialType) ?? Number.MAX_SAFE_INTEGER
      : Number.MAX_SAFE_INTEGER;
    return (
      aOrder - bOrder ||
      a.descriptionSnapshot.localeCompare(b.descriptionSnapshot)
    );
  });

  return sortedMaterials.map((material) => {
    const sourceQuantity = safeQuantity(material.orderedQuantity);
    const display = customerQuantity(sourceQuantity, material.purchaseUnit);
    const unitDivisor = display.quantity > 0 ? display.quantity : 1;
    const lineTotalCents = Math.max(0, material.netActualCostCents);
    const definition = getRoofingMaterialDefinition(material.materialType);

    return {
      id: `job-material-${material.id}`,
      category: material.materialType || material.category || "roofing_material",
      title:
        material.descriptionSnapshot.trim() ||
        definition?.label ||
        "Roofing material",
      customerDescription: lineDescription(material),
      internalDescription: `Synced from job materials: ${sourceQuantity} ${material.purchaseUnit}`,
      quantity: display.quantity,
      unit: display.unit,
      unitCostCents: Math.round(material.grossPurchaseCostCents / unitDivisor),
      unitPriceCents: Math.round(lineTotalCents / unitDivisor),
      lineTotalCents,
      discountCents: 0,
      pricingMode: "unit_price",
      selectionType: "base",
      selected: true,
      customerVisible: true,
      taxable: true,
      source: "catalog",
    };
  });
}
