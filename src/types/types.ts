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
  amountCents: MoneyCents;
  payeeNickname: string; // denormalized for quick display
  payeeId?: ID;
  paidAt?: FSDate;
  method?: PaymentMethod;
  memo?: string;
  attachmentUrls?: string[]; // photos of checks/receipts
};

export type MaterialExpense = {
  id: ID;
  name: string;  // e.g., "Shingles - Landmark Moire Black"
  vendor?: string; // e.g., "ABC Supply"
  amountCents: MoneyCents;
  purchasedAt?: FSDate;
  receiptUrl?: string;
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

export type JobAttachment = Photo | { url: string; label?: string };

// ---------- Job ----------
export type JobStatus =
  | "draft"
  | "active"
  | "pending"
  | "invoiced"
  | "paid"
  | "closed"
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

  address: Address;

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
    // Do not store the document id as a field
    const { id, ...rest } = job as Job;
    return rest as DocumentData;
  },
  fromFirestore(snapshot: QueryDocumentSnapshot, options: SnapshotOptions): Job {
    const data = snapshot.data(options) as Omit<Job, "id">;
    return { id: snapshot.id, ...data };
  },
};
