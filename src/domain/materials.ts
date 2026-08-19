import type {
  RoofingMaterialCategory,
  RoofingMaterialType,
  RoofingUnit,
} from "./roofing";

export type RoofingMaterialDefinition = {
  value: RoofingMaterialType;
  label: string;
  description: string;
  category: RoofingMaterialCategory;
  pricingUnit: Extract<RoofingUnit, "EA" | "SQ">;
};

export const ROOFING_MATERIAL_DEFINITIONS: RoofingMaterialDefinition[] = [
  {
    value: "FIELD_SHINGLES",
    label: "Field shingles",
    description: "Primary roof-covering shingles measured by roofing square.",
    category: "FIELD_ROOFING",
    pricingUnit: "SQ",
  },
  {
    value: "HIP_RIDGE_SHINGLES",
    label: "Hip / ridge shingles",
    description: "Cap shingles for hips and ridges, measured by roofing square.",
    category: "HIP_RIDGE_CAP",
    pricingUnit: "SQ",
  },
  {
    value: "STARTER_STRIP",
    label: "Starter strip",
    description: "Starter-course material priced by the supplied unit.",
    category: "STARTER",
    pricingUnit: "EA",
  },
  {
    value: "FELT_UNDERLAYMENT",
    label: "Felt / underlayment",
    description: "Felt or synthetic roof underlayment measured by roofing square.",
    category: "UNDERLAYMENT",
    pricingUnit: "SQ",
  },
  {
    value: "DRIP_EDGE",
    label: "Drip edge / edge flashing",
    description: "Perimeter edge-metal components priced by unit.",
    category: "EDGE_METAL",
    pricingUnit: "EA",
  },
  {
    value: "PIPE_FLASHING_ROOF_JACK",
    label: "Pipe flashing / roof jacks",
    description: "Roof-penetration flashing components priced by unit.",
    category: "PENETRATION_ACCESSORY",
    pricingUnit: "EA",
  },
  {
    value: "ATTIC_VENT",
    label: "Attic vents",
    description: "Passive roof or attic ventilation components priced by unit.",
    category: "VENTILATION",
    pricingUnit: "EA",
  },
  {
    value: "EXHAUST_VENT",
    label: "Exhaust vents",
    description: "Exhaust ventilation components priced by unit.",
    category: "VENTILATION",
    pricingUnit: "EA",
  },
  {
    value: "L_FLASHING",
    label: "L flashing",
    description: "L-profile flashing pieces priced by unit.",
    category: "FLASHING",
    pricingUnit: "EA",
  },
  {
    value: "J_STEP_FLASHING",
    label: "J flashing / step flashing",
    description: "Wall and step-flashing components priced by unit.",
    category: "FLASHING",
    pricingUnit: "EA",
  },
  {
    value: "COUNTER_FLASHING",
    label: "Counter flashing",
    description: "Counter-flashing components priced by unit.",
    category: "FLASHING",
    pricingUnit: "EA",
  },
  {
    value: "TIN_CAPS",
    label: "Tin caps",
    description: "Roofing fastener caps priced by unit.",
    category: "FASTENER",
    pricingUnit: "EA",
  },
  {
    value: "ROOFING_COIL_NAILS",
    label: "Roofing coil nails",
    description: "Coil-nail supplies priced by unit.",
    category: "FASTENER",
    pricingUnit: "EA",
  },
];

export function getRoofingMaterialDefinition(
  type?: RoofingMaterialType | null
) {
  return ROOFING_MATERIAL_DEFINITIONS.find(
    (definition) => definition.value === type
  );
}
