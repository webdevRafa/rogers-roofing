import type {
  Address,
  FirestoreTime,
  ID,
  JobRoofMeasurement,
} from "../types/types";

export type LeadStatus =
  | "new"
  | "contacted"
  | "inspection_scheduled"
  | "estimate_in_progress"
  | "estimate_sent"
  | "won"
  | "lost"
  | "archived";

export type RoofingService =
  | "roof_replacement"
  | "roof_repair"
  | "storm_damage"
  | "new_construction"
  | "inspection"
  | "commercial_roofing"
  | "gutters"
  | "other";

export type CustomerLead = {
  id: ID;
  organizationId: ID;
  orgId?: ID;
  requestNumber?: string;
  requestType?: "estimate_request";
  status: LeadStatus;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  preferredContact: "phone" | "text" | "email";
  propertyAddress: Address;
  service: RoofingService;
  propertyType: "residential" | "commercial" | "multifamily" | "other";
  urgency: "emergency" | "within_week" | "within_month" | "planning";
  message?: string;
  insuranceClaimStarted?: boolean;
  referralSource?: string;
  consentToContact: boolean;
  source: "website" | "phone" | "referral" | "walk_in" | "other";
  assignedEmployeeId?: ID | null;
  linkedCustomerId?: ID | null;
  linkedJobId?: ID | null;
  linkedEstimateId?: ID | null;
  convertedAt?: FirestoreTime;
  createdAt?: FirestoreTime;
  updatedAt?: FirestoreTime;
  lastContactedAt?: FirestoreTime;
};

export type CustomerRecord = {
  id: ID;
  organizationId: ID;
  displayName: string;
  firstName?: string;
  lastName?: string;
  companyName?: string;
  email?: string;
  phone?: string;
  preferredContact?: "phone" | "text" | "email";
  billingAddress?: Address;
  propertyIds: ID[];
  activeJobIds: ID[];
  tags: string[];
  createdAt?: FirestoreTime;
  updatedAt?: FirestoreTime;
};

export type ProjectType =
  | "replacement"
  | "repair"
  | "storm_restoration"
  | "new_install"
  | "commercial"
  | "maintenance";

export type EstimateStatus =
  | "lead_received"
  | "inspection_scheduled"
  | "inspection_complete"
  | "draft"
  | "internal_review"
  | "ready_to_send"
  | "sent"
  | "viewed"
  | "revising"
  | "accepted"
  | "declined"
  | "expired"
  | "cancelled"
  | "converted_to_contract";

export type RoofingUnit =
  | "EA"
  | "PIECE"
  | "BOX"
  | "SQ"
  | "SF"
  | "LF"
  | "HR"
  | "DAY"
  | "LS"
  | "TON"
  | "SHEET"
  | "GAL"
  | "ROLL"
  | "BUNDLE"
  | "OTHER";

export type EstimateLineItem = {
  id: ID;
  code?: string | null;
  category: string;
  title: string;
  customerDescription: string;
  internalDescription?: string | null;
  quantity: number;
  unit: RoofingUnit;
  unitCostCents?: number | null;
  unitPriceCents: number;
  lineTotalCents: number;
  wastePercent?: number | null;
  discountCents: number;
  pricingMode:
    | "fixed"
    | "unit_price"
    | "allowance"
    | "time_and_material"
    | "no_charge"
    | "included";
  selectionType:
    | "base"
    | "required"
    | "optional"
    | "alternate"
    | "upgrade"
    | "credit";
  selected: boolean;
  customerVisible: boolean;
  taxable?: boolean | null;
  source: "manual" | "template" | "measurement" | "carrier" | "catalog";
};

export type RoofMeasurement = JobRoofMeasurement;

export type EstimateLaborFeesSnapshot = {
  materialTotalCents: number;
  laborCostCents: number;
  dumpsterFeeCents: number;
  roofLoadFeeCents: number;
  laborAndFeesTotalCents: number;
  /** Internal calculation inputs. Omitted by the public estimate endpoint. */
  payoutTotalCents?: number;
  overheadPercent?: number;
  overheadAmountCents?: number;
};

export type EstimateRecord = {
  id: ID;
  organizationId: ID;
  orgId?: ID;
  jobId: ID;
  sourceLeadId?: ID | null;
  customerId?: ID | null;
  number: string;
  version: number;
  status: EstimateStatus;
  documentType: "estimate" | "quote" | "proposal" | "bid";
  projectTitle?: string;
  scopeSummary?: string;
  issueDate?: string | null;
  validUntil?: string | null;
  customerSnapshot?: {
    name?: string;
    email?: string;
    phone?: string;
  };
  propertyAddressSnapshot?: Address;
  organizationSnapshot?: {
    name: string;
    legalName?: string;
    phone?: string;
    email?: string;
    address?: Address | null;
    logoUrl?: string | null;
  };
  roofMeasurements?: RoofMeasurement[];
  roofAreaSquareFeet?: number;
  roofSquares?: number;
  measurementsFinalized?: boolean;
  lineItems: EstimateLineItem[];
  laborFeesSnapshot?: EstimateLaborFeesSnapshot;
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  taxRatePercent?: number;
  totalCents: number;
  depositCents?: number;
  paymentTerms?: string;
  warrantyText?: string;
  notes?: string;
  assumptions: string[];
  exclusions: string[];
  publicToken?: string;
  /** Version associated with the current public customer link. */
  publicVersion?: number;
  /** Highest immutable version prepared for delivery. */
  latestVersion?: number;
  latestVersionContentHash?: string;
  /** Highest immutable version successfully delivered to the customer. */
  latestIssuedVersion?: number;
  latestIssuedContentHash?: string;
  latestIssuedPdfStoragePath?: string;
  sentAt?: FirestoreTime;
  viewedAt?: FirestoreTime;
  lastEmailSentAt?: FirestoreTime;
  lastEmailResendId?: string | null;
  emailSendInFlightAt?: FirestoreTime;
  acceptedAt?: FirestoreTime;
  frozenSnapshotHash?: string | null;
  createdAt?: FirestoreTime;
  updatedAt?: FirestoreTime;
};

export type EstimateVersionRecord = {
  id: ID;
  estimateId: ID;
  organizationId: ID;
  jobId: ID;
  number: string;
  version: number;
  status: "preparing" | "generated" | "sent" | "viewed" | "delivery_failed";
  contentHash: string;
  publicToken: string;
  snapshot: Omit<
    EstimateRecord,
    "status" | "version" | "createdAt" | "updatedAt"
  >;
  pdfStoragePath?: string;
  pdfFilename?: string;
  pdfSizeBytes?: number;
  sentTo?: string;
  resendEmailId?: string | null;
  pdfGeneratedAt?: FirestoreTime;
  sentAt?: FirestoreTime;
  viewedAt?: FirestoreTime;
  deliveryFailedAt?: FirestoreTime;
  createdAt?: FirestoreTime;
  updatedAt?: FirestoreTime;
};

export type InvoiceWorkflowStatus =
  | "draft"
  | "internal_review"
  | "approved"
  | "issued"
  | "sent"
  | "viewed"
  | "partially_paid"
  | "paid"
  | "past_due"
  | "disputed"
  | "void"
  | "refunded";

export type WarrantyPacketType =
  | "RESIDENTIAL_STANDARD_CLOSEOUT"
  | "RESIDENTIAL_INSURANCE_CLOSEOUT"
  | "RESIDENTIAL_REPAIR_WARRANTY"
  | "COMMERCIAL_ROOF_CLOSEOUT"
  | "NEW_CONSTRUCTION_ROOF_CLOSEOUT"
  | "MANUFACTURER_ENHANCED_WARRANTY_PACKET"
  | "WORKMANSHIP_ONLY_PACKET"
  | "SERVICE_REPAIR_COMPLETION_PACKET"
  | "CUSTOM_PACKET";

export type WarrantyPacketSectionStatus =
  | "ready"
  | "missing"
  | "not_applicable"
  | "needs_review";

export type WarrantyPacketSection = {
  key: string;
  title: string;
  status: WarrantyPacketSectionStatus;
  required: boolean;
  documentIds: ID[];
  note?: string;
};

export type WarrantyPacketRecord = {
  id: ID;
  organizationId: ID;
  jobId: ID;
  customerId?: ID | null;
  type: WarrantyPacketType;
  version: number;
  status: "draft" | "internal_review" | "ready" | "delivered" | "superseded";
  issueDate?: string | null;
  completionDate?: string | null;
  propertyAddressSnapshot: Address;
  customerNameSnapshot: string;
  sections: WarrantyPacketSection[];
  workmanshipWarrantyId?: ID | null;
  manufacturerWarrantyIds: ID[];
  generatedFileId?: ID | null;
  deliveredAt?: FirestoreTime;
  createdAt?: FirestoreTime;
  updatedAt?: FirestoreTime;
};

export type RoofingMaterialCategory =
  | "FIELD_ROOFING"
  | "STARTER"
  | "HIP_RIDGE_CAP"
  | "UNDERLAYMENT"
  | "LEAK_BARRIER"
  | "DECKING"
  | "STRUCTURAL_LUMBER"
  | "INSULATION"
  | "COVER_BOARD"
  | "FLASHING"
  | "EDGE_METAL"
  | "SHEET_METAL"
  | "PENETRATION_ACCESSORY"
  | "VENTILATION"
  | "FASTENER"
  | "ADHESIVE"
  | "SEALANT"
  | "PRIMER"
  | "CLEANER"
  | "TAPE"
  | "COATING"
  | "DRAINAGE"
  | "GUTTER"
  | "SKYLIGHT"
  | "ROOF_ACCESSORY"
  | "TEMPORARY_PROTECTION"
  | "SAFETY_CONSUMABLE"
  | "CLEANUP_SUPPLY"
  | "DELIVERY"
  | "FREIGHT"
  | "STOCKING"
  | "DISPOSAL"
  | "RENTAL"
  | "WARRANTY_FEE"
  | "PERMIT_FEE"
  | "MISCELLANEOUS";

export type RoofingMaterialType =
  | "FIELD_SHINGLES"
  | "HIP_RIDGE_SHINGLES"
  | "STARTER_STRIP"
  | "FELT_UNDERLAYMENT"
  | "DRIP_EDGE"
  | "PIPE_FLASHING_ROOF_JACK"
  | "ATTIC_VENT"
  | "EXHAUST_VENT"
  | "L_FLASHING"
  | "J_STEP_FLASHING"
  | "COUNTER_FLASHING"
  | "TIN_CAPS"
  | "ROOFING_COIL_NAILS";

export type MaterialCatalogItem = {
  id: ID;
  organizationId: ID;
  active: boolean;
  materialType?: RoofingMaterialType | null;
  internalCode: string;
  category: RoofingMaterialCategory;
  genericName: string;
  displayName: string;
  manufacturer?: string | null;
  productLine?: string | null;
  sku?: string | null;
  color?: string | null;
  purchaseUnit: RoofingUnit;
  usageUnit: RoofingUnit;
  purchaseToUsageConversion?: number | null;
  coverageQuantity?: number | null;
  coverageUnit?: RoofingUnit | null;
  roofSystemCompatibility: string[];
  warrantyPrograms: string[];
  requiredForWarranty: boolean;
  returnableDefault?: boolean | null;
  specialOrderDefault: boolean;
  defaultWastePercent?: number | null;
  preferredSupplierId?: ID | null;
  defaultCostCents?: number | null;
  defaultSellPriceCents?: number | null;
  costUpdatedAt?: FirestoreTime;
  createdAt?: FirestoreTime;
  updatedAt?: FirestoreTime;
};

export type JobMaterialActual = {
  id: ID;
  organizationId: ID;
  jobId: ID;
  catalogItemId?: ID | null;
  materialType?: RoofingMaterialType | null;
  category?: RoofingMaterialCategory | null;
  descriptionSnapshot: string;
  manufacturerSnapshot?: string | null;
  productSnapshot?: string | null;
  colorSnapshot?: string | null;
  purchaseUnit: RoofingUnit;
  orderedQuantity: number;
  receivedQuantity: number;
  installedQuantity?: number | null;
  returnedToSupplierQuantity: number;
  returnedToInventoryQuantity: number;
  wastedQuantity?: number | null;
  grossPurchaseCostCents: number;
  taxCents: number;
  freightCents: number;
  deliveryCents: number;
  stockingCents: number;
  surchargeCents: number;
  restockingFeeCents: number;
  supplierCreditsCents: number;
  rebatesCents: number;
  netActualCostCents: number;
  supplierId?: ID | null;
  supplierName?: string | null;
  supplierInvoiceId?: ID | null;
  lotOrBatch?: string | null;
  warrantyComponent?: boolean;
  installedAt?: FirestoreTime;
  createdAt?: FirestoreTime;
  updatedAt?: FirestoreTime;
};

export const MATERIAL_CATEGORY_LABELS: Record<RoofingMaterialCategory, string> = {
  FIELD_ROOFING: "Field roofing",
  STARTER: "Starter",
  HIP_RIDGE_CAP: "Hip & ridge cap",
  UNDERLAYMENT: "Underlayment",
  LEAK_BARRIER: "Leak barrier",
  DECKING: "Decking",
  STRUCTURAL_LUMBER: "Structural lumber",
  INSULATION: "Insulation",
  COVER_BOARD: "Cover board",
  FLASHING: "Flashing",
  EDGE_METAL: "Edge metal",
  SHEET_METAL: "Sheet metal",
  PENETRATION_ACCESSORY: "Penetrations",
  VENTILATION: "Ventilation",
  FASTENER: "Fasteners",
  ADHESIVE: "Adhesives",
  SEALANT: "Sealants",
  PRIMER: "Primer",
  CLEANER: "Cleaner",
  TAPE: "Tape",
  COATING: "Coatings",
  DRAINAGE: "Drainage",
  GUTTER: "Gutters",
  SKYLIGHT: "Skylights",
  ROOF_ACCESSORY: "Roof accessories",
  TEMPORARY_PROTECTION: "Temporary protection",
  SAFETY_CONSUMABLE: "Safety consumables",
  CLEANUP_SUPPLY: "Cleanup supplies",
  DELIVERY: "Delivery",
  FREIGHT: "Freight",
  STOCKING: "Rooftop stocking",
  DISPOSAL: "Disposal",
  RENTAL: "Rental",
  WARRANTY_FEE: "Warranty fee",
  PERMIT_FEE: "Permit fee",
  MISCELLANEOUS: "Miscellaneous",
};

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  new: "New",
  contacted: "Contacted",
  inspection_scheduled: "Inspection scheduled",
  estimate_in_progress: "Estimate in progress",
  estimate_sent: "Estimate sent",
  won: "Won",
  lost: "Lost",
  archived: "Archived",
};

export const ESTIMATE_STATUS_LABELS: Record<EstimateStatus, string> = {
  lead_received: "Draft",
  inspection_scheduled: "Inspection scheduled",
  inspection_complete: "Inspection complete",
  draft: "Draft",
  internal_review: "Internal review",
  ready_to_send: "Ready to send",
  sent: "Sent",
  viewed: "Viewed",
  revising: "Revising",
  accepted: "Accepted",
  declined: "Declined",
  expired: "Expired",
  cancelled: "Cancelled",
  converted_to_contract: "Converted to contract",
};
