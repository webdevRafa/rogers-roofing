// types.ts
// Roofing job tracker — canonical data types
// Stack: React + TypeScript + TailwindCSS + Firebase (Firestore/Storage)

// ---------- Firebase-friendly primitives ----------
import type { Timestamp, FieldValue } from "firebase/firestore";

/** Store money in cents to avoid floating point errors. */
export type MoneyCents = number;

/** Firestore timestamp union that plays well client & server side. */
export type FSDate = Timestamp | Date | FieldValue;

/** ISO currency code. Keep single-currency first; expand if ever needed. */
export type CurrencyCode = "USD";

// ---------- Collections (centralize names to avoid typos) ----------
export const COLLECTIONS = {
  orgs: "organizations",
  users: "users",
  jobs: "jobs",
  jobNotes: "jobNotes", // optional subcollection alias if you split notes
  jobPhotos: "jobPhotos", // optional subcollection alias if you split photos
  payees: "payees", // subcontractors/vendors you pay
} as const;

// ---------- Common ----------
export type ID = string;

export type AuditFields = {
  createdAt?: FSDate | null;
  createdBy?: ID | null;
  updatedAt?: FSDate | null;
  updatedBy?: ID | null;
  deletedAt?: FSDate | null; // soft-delete (rare, but handy)
};

/** Optional organization / account container for multi-tenant setups. */
export type Organization = {
  id: ID;
  name: string;
  ownerUserId: ID;
  currency?: CurrencyCode;
  /** For simple role checks; expand to granular RBAC later if needed. */
  members?: Array<{ userId: ID; role: "owner" | "admin" | "member" }>;
} & AuditFields;

/** Minimal user shape for attribution on notes/uploads. */
export type AppUser = {
  id: ID;
  displayName: string;
  email?: string | null;
  avatarUrl?: string | null;
} & AuditFields;

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
  /** Optional geocoding (if you later map jobs). */
  geo?: { lat: number; lng: number };
};

// ---------- Earnings ----------
/**
 * Many roofers get paid in one lump sum; others in draws/insurance checks.
 * Keep a single top-level `totalEarningsCents` for simple UIs,
 * plus an optional breakdown array if they want itemization.
 */
export type EarningEntry = {
  id: ID;
  label?: string; // e.g., "Insurance ACV", "Final Payment"
  amountCents: MoneyCents;
  receivedAt?: FSDate | null;
  reference?: string; // check #, transaction id
  attachmentUrls?: string[]; // deposit slip, etc.
};

export type Earnings = {
  /** Cached sum for quick list sorting & display. */
  totalEarningsCents: MoneyCents;
  /** Optional line-item detail. */
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

/** Subcontractor/crew/vendor you pay. */
export type Payee = {
  id: ID;
  nickname: string; // "Crew A", "Dry-In Team", "ABC Dumpsters"
  /** Optional richer info if you want to pick from a list. */
  contactName?: string;
  phone?: string;
  email?: string;
  vendorType?: "crew" | "labor" | "dumpster" | "permit" | "supplier" | "other";
  defaultMethod?: PaymentMethod;
  notes?: string;
} & AuditFields;

/** Labor/subcontractor payout for a job. */
export type Payout = {
  id: ID;
  amountCents: MoneyCents;
  payeeNickname: string; // denormalized for quick display
  payeeId?: ID; // link to Payee if tracked
  paidAt?: FSDate | null;
  method?: PaymentMethod;
  memo?: string;
  attachmentUrls?: string[]; // photos of checks/receipts
};

export type MaterialExpense = {
  id: ID;
  name: string; // "Shingles - Landmark Moire Black"
  vendor?: string; // "ABC Supply"
  amountCents: MoneyCents;
  purchasedAt?: FSDate | null;
  attachmentUrls?: string[]; // receipt, invoice PDF, etc.
  notes?: string;
};

export type Expenses = {
  /** Cached sums for fast UI. */
  totalPayoutsCents: MoneyCents;
  totalMaterialsCents: MoneyCents;
  /** Optional detail lines. */
  payouts?: Payout[];
  materials?: MaterialExpense[];
  currency?: CurrencyCode;
};

// ---------- Notes & Photos ----------
export type Note = {
  id: ID;
  authorId: ID | null;
  authorName?: string | null; // denormalized
  body: string;
  createdAt?: FSDate | null;
  editedAt?: FSDate | null;
  /** Inline files (e.g., pic of soft-metal damage). */
  attachmentUrls?: string[];
} & AuditFields;

export type Photo = {
  id: ID;
  /** Storage paths help with clean deletes. */
  storagePath: string;
  fullUrl: string;
  thumbUrl?: string;
  caption?: string;
  uploadedBy?: ID | null;
  createdAt?: FSDate | null;
} & AuditFields;

// ---------- Job ----------
export type JobStatus =
  | "draft"
  | "active"
  | "invoiced"
  | "paid"
  | "closed"
  | "archived";

export type JobComputed = {
  /** Derived totals for quick list rendering & sorting. */
  totalExpensesCents: MoneyCents; // payouts + materials
  netProfitCents: MoneyCents; // earnings - expenses
};

export type Job = {
  id: ID;
  orgId?: ID; // multi-tenant
  status: JobStatus;

  address: Address;

  /** Earnings + Expense buckets with cached totals. */
  earnings: Earnings;
  expenses: Expenses;

  /** Freeform top-level notes (separate from threaded notes). */
  summaryNotes?: string;

  /** Optional arrays if you prefer embedding; or split into subcollections. */
  notes?: Note[];
  photos?: Photo[];

  /** Denormalized quick-sort fields. */
  lastModifiedAt?: FSDate | null;
  lastModifiedBy?: ID | null;

  /** For quick filtering/grouping in lists & reports. */
  tags?: string[]; // e.g., ["insurance", "reroof", "repair", "GAF"]
  salesRep?: string; // free-text or link a user id later
  crew?: string;

  /** Cached computed values updated on writes. */
  computed: JobComputed;

  currency?: CurrencyCode;
} & AuditFields;

/** Minimal list-row projection. */
export type JobListItem = {
  id: ID;
  addressLine: string;
  lastModifiedAt?: FSDate | null;
  status: JobStatus;
  netProfitCents: MoneyCents;
};

// ---------- Reporting ----------
export type ReportType = "jobs" | "earnings" | "expenses" | "profit";

export type ExportFormat = "csv" | "pdf" | "xlsx";

/** Filters for a simple “Download Report” dialog. */
export type ReportFilters = {
  orgId?: ID;
  dateFrom?: Date;
  dateTo?: Date;
  statusIn?: JobStatus[];
  salesRepIn?: string[];
  tagIn?: string[];
};

/** Row shapes you might export; keep lean for CSV/XLSX. */
export type JobReportRow = {
  jobId: ID;
  address: string;
  status: JobStatus;
  totalEarningsCents: MoneyCents;
  totalPayoutsCents: MoneyCents;
  totalMaterialsCents: MoneyCents;
  totalExpensesCents: MoneyCents;
  netProfitCents: MoneyCents;
  lastModifiedAt?: string; // ISO for export
};

export type EarningsReportRow = {
  jobId: ID;
  address: string;
  entryLabel?: string;
  amountCents: MoneyCents;
  receivedAt?: string; // ISO
};

export type ExpenseReportRow = {
  jobId: ID;
  address: string;
  kind: "payout" | "material";
  nameOrPayee: string;
  vendorOrMethod?: string;
  amountCents: MoneyCents;
  occurredAt?: string; // ISO
};

/** Standard page/limit params for list APIs or hooks. */
export type PageParams = {
  limit?: number; // default 25
  cursor?: string | null; // Firestore doc id or encoded key
};

// ---------- Utility helpers (types only) ----------
/** Convert cents to display; actual function will live elsewhere. */
export type CurrencyFormatOptions = {
  currency?: CurrencyCode;
  /** e.g., "accounting" to show negatives in parentheses in reports. */
  style?: "standard" | "accounting";
};

/** Narrow type used by UI when creating/updating a job. */
export type JobDraft = Omit<Job, "id" | "computed" | keyof AuditFields> & {
  id?: ID; // allow client-generated ids
  computed?: Partial<JobComputed>;
};

/** Lightweight union for anything attachable to a job. */
export type JobAttachment = Photo | { url: string; label?: string };

// ---------- Firestore document converters (optional, if you use them) ----------
// You can implement converters in your data layer using these types.
// Example (in your data access file, not here):
// export const jobConverter: FirestoreDataConverter<Job> = { ... };
