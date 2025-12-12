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

export type Employee = {
  id: string;
  name: string;
  /** Optional free-form address or structured address */
  address?: EmployeeAddress | string | null;
  isActive?: boolean;
  createdAt?: Timestamp | Date | FieldValue | null;
  updatedAt?: Timestamp | Date | FieldValue | null;
};

export type PayoutDoc = {
  id: string;
  jobId: string;
  employeeId: string;
  employeeNameSnapshot: string;

  /** copied from Job at the time of payout for reporting */
  jobAddressSnapshot?: Job["address"];

  category: "shingles" | "felt" | "technician";
  amountCents: number;
  method: "check" | "cash" | "zelle" | "other";
  sqft?: number;
  ratePerSqFt?: number;

  createdAt: Timestamp | FieldValue;
  paidAt?: Timestamp | Date | FieldValue | null;

  stubId?: string;
  paidStubNumber?: string;
  payoutStubId?: string;
};

// ---------- Earnings ----------
export type EarningEntry = {
  id: ID;
  label?: string; // e.g., "Insurance ACV", "Final Payment"
  amountCents: MoneyCents;
  receivedAt?: FSDate;
  reference?: string; // check #, transaction id
  attachmentUrls?: string[];
};

export type Earnings = {
  /** Cached sum for quick display & sorting */
  totalEarningsCents: MoneyCents;
  entries?: EarningEntry[];
  currency?: CurrencyCode;
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
};
export type MaterialCategory =
  | "coilNails"
  | "tinCaps"
  | "np1Seal"
  | "plasticJacks"
  | "counterFlashing"
  | "jFlashing"
  | "rainDiverter";


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
  status: InvoiceStatus;
  // For receipts, store how it was paid if you want:
  paymentNote?: string;    // e.g. "Paid by check #1023"
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

  /** Material scheduling / completion for this job. */
  feltScheduledFor?: FSDate;
  feltCompletedAt?: FSDate;
  shinglesScheduledFor?: FSDate;
  shinglesCompletedAt?: FSDate;

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
