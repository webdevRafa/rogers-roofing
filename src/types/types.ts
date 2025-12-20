// src/types/types.ts
import type {
  FirestoreDataConverter,
  QueryDocumentSnapshot,
  SnapshotOptions,
  WithFieldValue,
  DocumentData,
  Timestamp,
  FieldValue,
} from "firebase/firestore";

export type MoneyCents = number;
export type CurrencyCode = "USD" | "CAD";
export type ID = string;
export type FSDate = Timestamp | Date | FieldValue | null;
export type FirestoreTime = Timestamp | Date | FieldValue | null;

// ---------- Address ----------
export type Address = {
  /** Full display line, e.g. "123 Main St, San Antonio, TX 78205" */
  fullLine: string;
  street?: string;
  unit?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string; // "US"
  geo?: { lat: number; lng: number };
};

export type EmployeeAddress = {
  fullLine?: string;
  line1?: string;
  city?: string;
  state?: string;
  zip?: string;
};
/**
 * Roofing-specific crew roles (trade roles).
 * Keep this list practical + expandable.
 */
export type CrewRole =
  | "owner"
  | "office"
  | "projectManager"
  | "supervisor"     // general supervisor (can map to "technician" if you want)
  | "technician"     // site verifier / QA / punch / supplement runner
  | "foreman"
  | "roofer"
  | "laborer"
  | "driver"
  | "subcontractor"
  | "other";

/**
 * App access roles (authorization). Separate from trade role.
 * This is what you'll use later to guard UI/routes.
 */
export type AccessRole = "admin" | "manager" | "crew" | "readOnly";

/**
 * High-level employee invite status (claim flow).
 */
export type EmployeeInviteStatus =
  | "none"        // no invite created
  | "pending"     // invite created + email sent
  | "sent"        // (optional) you can mark explicitly if you want
  | "accepted"    // crew member claimed the account
  | "expired"
  | "revoked";

/**
 * Stored on the Employee doc for UX convenience.
 * IMPORTANT: do NOT store secret tokens here.
 */
export type EmployeeInviteMeta = {
  status: EmployeeInviteStatus;

  /** Email that invite was sent to (can differ from employee.email if edited) */
  email?: string | null;

  invitedAt?: FirestoreTime;
  invitedByUserId?: ID | null;

  /** When the crew member accepted/claimed */
  acceptedAt?: FirestoreTime;

  /** If you use expiring invites */
  expiresAt?: FirestoreTime;

  /** Link last sent time for "Resend invite" */
  lastSentAt?: FirestoreTime;
};

/**
 * Separate collection (recommended): employeeInvites
 * This holds the "invite record" you will resolve when the user clicks the link.
 */
export type EmployeeInviteDoc = {
  id: ID;

  orgId: ID;
  employeeId: ID;

  email: string;

  /** snapshot the chosen role at invite time */
  roleSnapshot?: CrewRole | null;
  accessRoleSnapshot?: AccessRole | null;

  status: EmployeeInviteStatus; // pending/accepted/expired/revoked
  createdAt: FirestoreTime;
  createdByUserId?: ID | null;

  acceptedAt?: FirestoreTime;
  acceptedByUserId?: ID | null;

  /** optional housekeeping */
  expiresAt?: FirestoreTime;
  revokedAt?: FirestoreTime;
  revokedByUserId?: ID | null;
};

export type Employee = {
  id: string;
  name: string;
  address?: EmployeeAddress | string | null;
  orgId?: ID;
  email?: string | null;
  phone?: string | null;


  role?: CrewRole | null;
  accessRole?: AccessRole | null;

  userId?: string | null;

  /**
   * Link to the OrgMember document for this employee, if applicable.
   * When migrating to the multi‑tenant model, set this to the membership
   * record id that ties the user to the organization.  Existing records
   * may omit this field.
   */
  orgMemberId?: ID | null;

  invite?: EmployeeInviteMeta | null;
  isActive?: boolean;
  createdAt?: Timestamp | Date | FieldValue | null;
  updatedAt?: Timestamp | Date | FieldValue | null;
  deletedAt?: Timestamp | Date | FieldValue | null;
};

export type PayoutDoc = {
  id: string;
  jobId?: string | null;
  employeeId: string;
  employeeNameSnapshot: string;

  /** copied from Job at the time of payout for reporting */
  jobAddressSnapshot?: Job["address"];

  category: "shingles" | "felt" | "technician";
  amountCents: number;
  method: "check" | "cash" | "zelle" | "other";
  sqft?: number;
  ratePerSqFt?: number;

   // technician breakdown
   daysWorked?: number;
   ratePerDayCents?: number;
   note?: string;
  createdAt: Timestamp | FieldValue;
  paidAt?: Timestamp | Date | FieldValue | null;

  stubId?: string;
  paidStubNumber?: string;
  payoutStubId?: string;

  /** Owning organization for this payout.  Optional for backward compatibility. */
  orgId: ID;
};
export type Org = {
  id: ID;
  name: string;

  /** for branding on stubs/reports later */
  legalName?: string;
  phone?: string;
  email?: string;
  address?: Address | null;
  logoUrl?: string | null;

  createdAt?: FirestoreTime;
  updatedAt?: FirestoreTime;
};

export type OrgMemberRole = "owner" | "admin" | "manager" | "crew" | "readOnly";

export type OrgMember = {
  id: ID;          // could be `${orgId}_${userId}` or auto id
  orgId: ID;
  userId: ID;      // Firebase Auth uid

  role: OrgMemberRole;

  /** optionally link to Employee doc if this user is also an employee */
  employeeId?: ID | null;

  createdAt?: FirestoreTime;
  updatedAt?: FirestoreTime;
};

/**
 * A global User record representing an individual person.
 * Users exist outside the context of any one organization and
 * can belong to multiple organizations via OrgMember records.
 * Keep fields optional to avoid breaking existing Employee-based flows.
 */
export type User = {
  /** Firebase Auth uid */
  id: ID;
  /** Full name (copied from Employee when created) */
  name?: string | null;
  /** Primary email for the user */
  email?: string | null;
  /** Optional phone number */
  phone?: string | null;
  /** Timestamp when the user record was created */
  createdAt?: FirestoreTime;
  /** Timestamp when the user record was last updated */
  updatedAt?: FirestoreTime;
  /** Soft delete timestamp */
  deletedAt?: FirestoreTime | null;
};

/**
 * Alias types to make the multi‑tenant model explicit without
 * breaking existing imports. Organization is equivalent to Org,
 * and Membership is equivalent to OrgMember.  You can gradually
 * migrate code to use these new names while old names continue to work.
 */
export type Organization = Org;
export type Membership = OrgMember;

// ---------- Earnings ----------
export type EarningEntry = {
  id: ID;
  label?: string; // e.g., "Insurance ACV", "Final Payment"
  amountCents: MoneyCents;
  receivedAt?: FSDate;
  reference?: string; // check #, transaction id
  attachmentUrls?: string[];
};

export type FlashingPay = {
  /** Units of flashing pay (e.g. 1, 2, 10) */
  units: number;
  /** Price per unit in cents */
  unitPriceCents: number;
  /** Cached amount = units * unitPriceCents */
  amountCents: MoneyCents;
  /** Optional audit timestamp */
  updatedAt?: FirestoreTime;
};

export type ContactInfo = {
  name?: string;
  phone?: string;
  email?: string;
};

export type WarrantyAttachment = {
  id: ID;
  label?: string; // "Invoice", "Warranty Cert", "Before photo", etc
  url: string;
  kind?:
    | "invoice"
    | "receipt"
    | "warrantyCertificate"
    | "registrationConfirmation"
    | "claimDocument"
    | "beforePhoto"
    | "afterPhoto"
    | "other";
  createdAt?: FirestoreTime;
};

export type WarrantyKind =
  | "manufacturer"
  | "workmanship"
  | "thirdParty"
  | "insurance"
  | "none";

export type WarrantyStatus =
  | "notStarted"
  | "draft"
  | "submitted"
  | "registered"
  | "active"
  | "expired"
  | "claimOpened"
  | "closed";

export type WarrantyMeta = {
  kind: WarrantyKind;

  /** High-level lifecycle status so the UI can show “Draft / Submitted / Registered” etc. */
  status?: WarrantyStatus;

  /** Program info (Manufacturer / 3rd party) */
  manufacturer?: string; // "GAF", "Owens Corning", "CertainTeed", etc (free text)
  programName?: string; // "Golden Pledge", "Platinum", etc (free text)
  coverageYears?: number;

  /** Dates that matter for warranty packets */
  installDate?: FirestoreTime; // when roof was installed (often shingles completion)
  repairDate?: FirestoreTime; // if this job is actually a warranty repair job
  expiresAt?: FirestoreTime;

  /** Registration tracking */
  registeredAt?: FirestoreTime;
  submittedAt?: FirestoreTime;
  registrationId?: string;

  /** Claim tracking (manufacturer/3rd party/insurance) */
  claimId?: string;
  claimNumber?: string; // some systems call it claim # instead of claimId
  claimStatus?: "open" | "pending" | "approved" | "denied" | "closed";
  claimOpenedAt?: FirestoreTime;
  claimClosedAt?: FirestoreTime;

  /** Where/How you submit */
  portalUrl?: string;
  submittedBy?: { userId?: ID; name?: string };

  /** People involved */
  homeowner?: ContactInfo; // name/phone/email
  adjuster?: ContactInfo; // insurance adjuster (optional)
  thirdPartyAdmin?: ContactInfo; // 3rd-party warranty company (optional)

  /** Insurance-ish metadata (optional, but common with “3rd party” talk) */
  insuranceCarrier?: string;
  policyNumber?: string;

  /** Extra notes specifically for warranty/3rd-party context */
  notes?: string;

  /** Supporting documents (invoice, cert, confirmation, etc.) */
  attachments?: WarrantyAttachment[];
};


export type Earnings = {
  /** Cached sum for quick display & sorting */
  totalEarningsCents: MoneyCents;
  entries?: EarningEntry[];
  materialPay?: MaterialPayItem[];
  currency?: CurrencyCode;
  flashingPay?: FlashingPay;
};
export type PayoutCategory = "shingles" | "felt" | "technician";
// ---------- Expenses ----------
export type PaymentMethod =
  | "cash"
  | "check"
  | "ach"
  | "zelle"
  | "venmo"
  | "card"
  | "other";

export type Payout = {
  id: ID;
  employeeId?: string;
  amountCents: MoneyCents;
  payeeNickname: string; // denormalized for quick display
  payeeId?: ID;
  paidAt?: FSDate;
  method?: PaymentMethod;
  category?: PayoutCategory;
  sqft?: number; 
  ratePerSqFt?: number;
  memo?: string;
  attachmentUrls?: string[]; // photos of checks/receipts

  /**
   * Owning organization for this payout. When present this
   * links the payout to its tenant. Optional for backward compatibility.
   */
  orgId?: ID;
};
export type MaterialCategory =
  | "coilNails"
  | "tinCaps"
  | "np1Seal"
  | "plasticJacks"
  | "counterFlashing"
  | "jFlashing"
  | "rainDiverter";



  export type MaterialPayCategory =
  | "counterFlashing";

export type MaterialPayItem = {
  id: ID;
  category: MaterialPayCategory;
  label?: string;          // e.g. "C/J/L Flashing"
  quantity: number;        // e.g. 12
  unitPriceCents: number;  // e.g. 2500 ($25)
  amountCents: MoneyCents; // quantity * unitPriceCents (cached)
  receivedAt?: FSDate;
  note?: string;
};



export type MaterialExpense = {
  id: ID;
  category: MaterialCategory;
  unitPriceCents: number;
  quantity: number; 
  name?: string;  // e.g., "Shingles - Landmark Moire Black"
  vendor?: string; // e.g., "ABC Supply"
  createdAt?: FirestoreTime;
  amountCents: MoneyCents;
  purchasedAt?: FSDate;
  receiptUrl?: string;

  /** Owning organization for this material expense. Optional for backward compatibility. */
  orgId?: ID;
};
export type JobPricing = {
  sqft: number;                 // >= 0
  ratePerSqFt: 31 | 35;         // your two allowed rates
  feeCents?: number;            // default 3500 for the +$35 fee
};
export type Expenses = {
  /** Cached sums for fast UI */
  totalPayoutsCents: MoneyCents;
  totalMaterialsCents: MoneyCents;
  payouts?: Payout[];
  materials?: MaterialExpense[];
  currency?: CurrencyCode;
};

// ---------- Notes & Photos ----------
export type Note = {
  id: ID;
  authorId?: string;
  authorName?: string;
  text: string;
  createdAt?: FSDate;
  createdBy?: ID | null;
};

export type Photo = {
  id: ID;
  url: string;
  caption?: string;
  uploadedBy?: ID | null;
  createdAt?: FSDate;
};
// types.ts (additions)

export type InvoiceStatus = "draft" | "sent" | "paid" | "void";

export interface InvoiceMoney {
  materialsCents: number;  // snapshot of job.expenses.totalMaterialsCents
  laborCents: number;      // sum of payouts at creation time
  extraCents: number;      // any extra expenses included on invoice (optional)
  subtotalCents: number;
  taxCents: number;        // if you later add tax rules; for now 0
  totalCents: number;
}
export type PayoutStubStatus = "draft" | "paid" | "void";

export interface PayoutStubLine {
  payoutId: string;
  jobId?: string;
  category?: string; // felt | shingles | technician
  sqft?: number;
  ratePerSqFt?: number;
  amountCents: number;
  daysWorked?: number;
ratePerDayCents?: number;
note?: string;
  jobAddressSnapshot?: {
    fullLine?: string;
    line1?: string;
    city?: string;
    state?: string;
    zip?: string;
  };
}

export interface PayoutStubDoc {
  id: string;
  number: string;          // e.g. STUB-2025-000123
  employeeId: string;
  employeeNameSnapshot: string;
  employeeAddressSnapshot?: {
    fullLine?: string;
    line1?: string;
    city?: string;
    state?: string;
    zip?: string;
  };

  payoutIds: string[];
  jobIds: string[];        // unique list from lines

  lines: PayoutStubLine[];

  totalCents: number;
  createdAt: Timestamp | Date | FieldValue;
  paidAt?: Timestamp | Date | FieldValue;
  status: PayoutStubStatus;

  // optional, later:
  pdfUrl?: string;
  notes?: string;

  /** Owning organization for this stub.  Optional for backward compatibility. */
  orgId: ID;
}

export interface InvoiceLine {
  id: string;
  label: string;           // e.g., "Labor (payouts)", "Coil Nails (3 x $45)", "Extra: Dumpster"
  amountCents: number;
}

export type InvoiceKind = "invoice" | "receipt";

export interface InvoiceDoc {
  id: string;
  kind: InvoiceKind;       // "invoice" or "receipt"
  jobId: string;
  number: string;          // e.g., INV-2025-000123
  customer?: {
    name?: string;
    email?: string;
    phone?: string;
  };
  addressSnapshot?: {
    fullLine?: string;
    line1?: string;
    city?: string;
    state?: string;
    zip?: string;
  };
  description?: string;    // user-entered description for the work performed
  lines: InvoiceLine[];    // human-friendly rolled-up lines
  money: InvoiceMoney;     // computed totals
  createdAt: Timestamp | Date | FieldValue;
  updatedAt?: Timestamp | Date | FieldValue;
  paidAt?: Timestamp | Date | FieldValue;
  sentAt?: Timestamp | Date | FieldValue;
  publicToken?: string;
lastEmailSentAt?: any;
  status: InvoiceStatus;
  // For receipts, store how it was paid if you want:
  paymentNote?: string;    // e.g. "Paid by check #1023"

  /** Owning organization for this invoice. Optional for backward compatibility. */
  orgId?: ID;
}

export type JobAttachment = Photo | { url: string; label?: string };

// ---------- Job ----------
export type JobStatus =
  | "draft"
  | "active"
  | "pending"
  | "invoiced"
  | "paid"
  | "closed"
  | "completed"
  | "archived";

export type JobComputed = {
  /** Derived totals for quick list rendering & sorting */
  totalExpensesCents: MoneyCents; // payouts + materials
  netProfitCents: MoneyCents; // earnings - expenses
};

export type AuditFields = {
  createdAt?: FSDate;
  createdBy?: ID | null;
  updatedAt?: FSDate;
  updatedBy?: ID | null;
  deletedAt?: FSDate | null;
};

export type Job = {
  id: ID;
  orgId?: ID; // multi-tenant future-proofing
  status: JobStatus;
  pricing?: JobPricing;
  address: Address;

  /** Final punch information (walkthrough / completion). */
  punchedAt?: Timestamp | Date | FieldValue | null;
  /** When this job is scheduled to be punched (final walkthrough/finish). */
  punchScheduledFor?: FSDate;
  assignedEmployeeIds?: string[];
  /**
   * For multi‑tenant support, optionally track assignments by membership.
   * Jobs created before introducing the Membership model will not have this
   * field.  When present, use this instead of assignedEmployeeIds to
   * associate a job with specific organization members.
   */
  assignedOrgMemberIds?: ID[];
  /** Material scheduling / completion for this job. */
  feltScheduledFor?: FSDate;
  feltCompletedAt?: FSDate;
  shinglesScheduledFor?: FSDate;
  shinglesCompletedAt?: FSDate;
  warranty?: WarrantyMeta;
  warrantyPacket?: {
    lastGeneratedAt?: FirestoreTime;
    lastGeneratedBy?: ID | null;
    lastMode?: "internal" | "external";
  };
  
  earnings: Earnings;
  expenses: Expenses;

  /** Freeform top-level notes (separate from threaded notes). */
  summaryNotes?: string;

  notes?: Note[];
  attachments?: JobAttachment[];

  computed?: JobComputed;
} & AuditFields;


/** Minimal list-row projection. */
export type JobListItem = {
  id: ID;
  addressLine: string;
  lastModifiedAt?: FSDate | null;
  status: JobStatus;
  netProfitCents: MoneyCents;

  /** Owning organization for this job. Optional for backward compatibility. */
  orgId?: ID;
};

export type JobDraft = Omit<Job, "id" | keyof AuditFields | "computed"> & {
  id?: ID;
  computed?: Partial<JobComputed>;
};

// ---------- Firestore Converter ----------
export const jobConverter: FirestoreDataConverter<Job> = {
  toFirestore(job: WithFieldValue<Job>): DocumentData {
    // drop the 'id' field from what we write to Firestore
    const { id: _omit, ...rest } = job as Job;
    void _omit; // mark as intentionally unused (silences no-unused-vars)
    return rest as DocumentData;
  },
  fromFirestore(snapshot: QueryDocumentSnapshot, options: SnapshotOptions): Job {
    const data = snapshot.data(options) as Omit<Job, "id">;
    return { id: snapshot.id, ...data };
  },
};
