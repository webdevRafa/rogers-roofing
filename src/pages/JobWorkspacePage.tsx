import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BriefcaseBusiness,
  CalendarDays,
  Check,
  CircleDollarSign,
  ClipboardCheck,
  Eye,
  FileCheck2,
  FileStack,
  HandCoins,
  Image,
  Mail,
  MapPin,
  PackageCheck,
  PackageSearch,
  Pencil,
  Phone,
  Plus,
  ReceiptText,
  Ruler,
  ShieldCheck,
  UploadCloud,
  Users,
  X,
} from "lucide-react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import {
  collection,
  doc,
  increment,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { getStorage, ref as storageRef, uploadBytes } from "firebase/storage";

import { useOrg } from "../contexts/OrgContext";
import { db } from "../firebase/firebaseConfig";
import {
  getRoofingMaterialDefinition,
  ROOFING_MATERIAL_DEFINITIONS,
} from "../domain/materials";
import {
  ESTIMATE_STATUS_LABELS,
  type EstimateRecord,
  type JobMaterialActual,
  type RoofingMaterialType,
  type WarrantyPacketSection,
} from "../domain/roofing";
import type {
  Employee,
  InvoiceDoc,
  Job,
  JobStatus,
  PayoutDoc,
} from "../types/types";

type WorkspaceTab =
  | "overview"
  | "financials"
  | "materials"
  | "payouts"
  | "warranty"
  | "files";

const workspaceTabs: WorkspaceTab[] = [
  "overview",
  "financials",
  "materials",
  "payouts",
  "warranty",
  "files",
];

function requestedWorkspaceTab(value: string | null): WorkspaceTab {
  return workspaceTabs.includes(value as WorkspaceTab)
    ? (value as WorkspaceTab)
    : "overview";
}

type PhotoDoc = {
  id: string;
  jobId: string;
  url: string;
  caption?: string;
  createdAt?: unknown;
};

type MaterialForm = {
  materialType: RoofingMaterialType | "";
  description: string;
  manufacturer: string;
  product: string;
  color: string;
  quantity: string;
  rate: string;
  tax: string;
  delivery: string;
  freight: string;
  supplier: string;
  warrantyComponent: boolean;
};

const initialMaterialForm: MaterialForm = {
  materialType: "",
  description: "",
  manufacturer: "",
  product: "",
  color: "",
  quantity: "",
  rate: "",
  tax: "",
  delivery: "",
  freight: "",
  supplier: "",
  warrantyComponent: false,
};

type TimestampLike = { toDate?: () => Date; seconds?: number };

function toDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  const timestamp = value as TimestampLike;
  if (typeof timestamp.toDate === "function") return timestamp.toDate();
  if (typeof timestamp.seconds === "number") {
    return new Date(timestamp.seconds * 1000);
  }
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function formatDate(value: unknown): string {
  const date = toDate(value);
  if (!date) return "Not set";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function money(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

function addressLine(job: Job): string {
  if (typeof job.address === "string") return job.address;
  return job.address?.fullLine || "Address not added";
}

function projectLabel(type?: Job["projectType"]): string {
  const labels: Record<NonNullable<Job["projectType"]>, string> = {
    replacement: "Roof replacement",
    repair: "Roof repair",
    storm_restoration: "Storm restoration",
    new_install: "New installation",
    commercial: "Commercial roofing",
    maintenance: "Maintenance",
  };
  return type ? labels[type] : "Roofing project";
}

function invoiceBalance(invoice: InvoiceDoc): number {
  return invoice.status === "paid" || invoice.status === "void"
    ? 0
    : invoice.money?.totalCents ?? 0;
}

export default function JobWorkspacePage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { orgId } = useOrg();
  const [tab, setTab] = useState<WorkspaceTab>(() =>
    requestedWorkspaceTab(searchParams.get("tab"))
  );
  const [job, setJob] = useState<Job | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [payouts, setPayouts] = useState<PayoutDoc[]>([]);
  const [invoices, setInvoices] = useState<InvoiceDoc[]>([]);
  const [estimates, setEstimates] = useState<EstimateRecord[]>([]);
  const [materials, setMaterials] = useState<JobMaterialActual[]>([]);
  const [photos, setPhotos] = useState<PhotoDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [materialOpen, setMaterialOpen] = useState(false);
  const [materialForm, setMaterialForm] = useState(initialMaterialForm);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoCaption, setPhotoCaption] = useState("");
  const [photoUploading, setPhotoUploading] = useState(false);
  const [photoMessage, setPhotoMessage] = useState<string | null>(null);

  const selectedMaterialDefinition = getRoofingMaterialDefinition(
    materialForm.materialType || null
  );
  const materialProductCostPreview =
    Math.max(0, Number(materialForm.quantity) || 0) *
    Math.max(0, Number(materialForm.rate) || 0);
  const materialAddOnsPreview = [
    materialForm.tax,
    materialForm.delivery,
    materialForm.freight,
  ].reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0);

  function selectTab(nextTab: WorkspaceTab) {
    setTab(nextTab);
    const nextParams = new URLSearchParams(searchParams);
    if (nextTab === "overview") nextParams.delete("tab");
    else nextParams.set("tab", nextTab);
    setSearchParams(nextParams, { replace: true });
  }

  function openMaterialForm() {
    setMaterialForm(initialMaterialForm);
    setError(null);
    setMaterialOpen(true);
  }

  function closeMaterialForm() {
    if (saving) return;
    setMaterialForm(initialMaterialForm);
    setError(null);
    setMaterialOpen(false);
  }

  function selectMaterialType(materialType: RoofingMaterialType) {
    const definition = getRoofingMaterialDefinition(materialType);
    setMaterialForm({
      ...initialMaterialForm,
      materialType,
      description: definition?.label ?? "",
    });
    setError(null);
  }

  useEffect(() => {
    if (!id) return;
    const unsubscribe = onSnapshot(
      doc(db, "jobs", id),
      (snapshot) => {
        if (!snapshot.exists()) {
          setJob(null);
          setLoading(false);
          return;
        }
        const nextJob = {
          id: snapshot.id,
          ...(snapshot.data() as Omit<Job, "id">),
        };
        setJob(nextJob);
        setNotes(nextJob.summaryNotes || "");
        setLoading(false);
      },
      (snapshotError) => {
        setError(snapshotError.message);
        setLoading(false);
      }
    );
    return unsubscribe;
  }, [id]);

  useEffect(() => {
    if (!id) return;
    const unsubs = [
      onSnapshot(
        query(collection(db, "payouts"), where("jobId", "==", id)),
        (snapshot) =>
          setPayouts(
            snapshot.docs.map((document) => ({
              id: document.id,
              ...(document.data() as Omit<PayoutDoc, "id">),
            }))
          )
      ),
      onSnapshot(
        query(collection(db, "invoices"), where("jobId", "==", id)),
        (snapshot) => {
          const nextInvoices = snapshot.docs.map((document) => ({
            id: document.id,
            ...(document.data() as Omit<InvoiceDoc, "id">),
          }));
          nextInvoices.sort(
            (a, b) =>
              (toDate(b.updatedAt || b.createdAt)?.getTime() || 0) -
              (toDate(a.updatedAt || a.createdAt)?.getTime() || 0)
          );
          setInvoices(nextInvoices);
        }
      ),
      onSnapshot(
        query(collection(db, "estimates"), where("jobId", "==", id)),
        (snapshot) => {
          const nextEstimates = snapshot.docs.map((document) => ({
            id: document.id,
            ...(document.data() as Omit<EstimateRecord, "id">),
          }));
          nextEstimates.sort(
            (a, b) =>
              (toDate(b.updatedAt || b.createdAt)?.getTime() || 0) -
              (toDate(a.updatedAt || a.createdAt)?.getTime() || 0)
          );
          setEstimates(nextEstimates);
        }
      ),
      onSnapshot(
        query(collection(db, "jobMaterials"), where("jobId", "==", id)),
        (snapshot) =>
          setMaterials(
            snapshot.docs.map((document) => ({
              id: document.id,
              ...(document.data() as Omit<JobMaterialActual, "id">),
            }))
          )
      ),
      onSnapshot(
        query(collection(db, "jobPhotos"), where("jobId", "==", id)),
        (snapshot) =>
          setPhotos(
            snapshot.docs.map((document) => ({
              id: document.id,
              ...(document.data() as Omit<PhotoDoc, "id">),
            }))
          )
      ),
    ];
    return () => unsubs.forEach((unsubscribe) => unsubscribe());
  }, [id]);

  useEffect(() => {
    if (!orgId) return;
    return onSnapshot(
      query(collection(db, "employees"), where("orgId", "==", orgId)),
      (snapshot) =>
        setEmployees(
          snapshot.docs.map((document) => ({
            id: document.id,
            ...(document.data() as Omit<Employee, "id">),
          }))
        )
    );
  }, [orgId]);

  const financials = useMemo(() => {
    const revenue = job?.earnings?.totalEarningsCents ?? 0;
    const materialCost =
      materials.length > 0
        ? materials.reduce(
            (sum, material) => sum + material.netActualCostCents,
            0
          )
        : job?.expenses?.totalMaterialsCents ?? 0;
    const payoutCost = payouts.reduce(
      (sum, payout) => sum + payout.amountCents,
      0
    );
    const outstanding = invoices.reduce(
      (sum, invoice) => sum + invoiceBalance(invoice),
      0
    );
    return {
      revenue,
      materialCost,
      payoutCost,
      totalCost: materialCost + payoutCost,
      profit: revenue - materialCost - payoutCost,
      outstanding,
    };
  }, [invoices, job, materials, payouts]);

  const assignedEmployees = useMemo(
    () =>
      employees.filter((employee) =>
        job?.assignedEmployeeIds?.includes(employee.id)
      ),
    [employees, job?.assignedEmployeeIds]
  );

  const warrantySections = useMemo<WarrantyPacketSection[]>(() => {
    if (!job) return [];
    const paidFinalInvoice = invoices.some(
      (invoice) => invoice.status === "paid"
    );
    const hasCompletionDate = Boolean(
      job.punchedAt || job.shinglesCompletedAt || job.feltCompletedAt
    );
    return [
      {
        key: "project_summary",
        title: "Project completion summary",
        status: hasCompletionDate ? "ready" : "missing",
        required: true,
        documentIds: [],
        note: hasCompletionDate
          ? "Completion activity is recorded."
          : "Record a completion or final punch date.",
      },
      {
        key: "installed_products",
        title: "Installed product schedule",
        status: materials.length > 0 ? "ready" : "missing",
        required: true,
        documentIds: [],
        note:
          materials.length > 0
            ? `${materials.length} material records are linked.`
            : "Add installed products and cost records.",
      },
      {
        key: "workmanship_warranty",
        title: "Contractor workmanship warranty",
        status: job.warranty?.coverageYears ? "ready" : "needs_review",
        required: true,
        documentIds: [],
        note: job.warranty?.coverageYears
          ? `${job.warranty.coverageYears}-year term recorded.`
          : "Warranty term and scope need review.",
      },
      {
        key: "manufacturer_warranty",
        title: "Manufacturer warranty evidence",
        status:
          job.warranty?.registrationId ||
          job.warranty?.status === "registered" ||
          job.warranty?.status === "active"
            ? "ready"
            : "needs_review",
        required: false,
        documentIds: [],
        note:
          job.warranty?.registrationId ||
          job.warranty?.status === "registered"
            ? "Registration evidence is recorded."
            : "Confirm eligibility, registration, and governing document.",
      },
      {
        key: "final_invoice",
        title: "Final invoice and payment record",
        status: paidFinalInvoice ? "ready" : "missing",
        required: true,
        documentIds: invoices.map((invoice) => invoice.id),
        note: paidFinalInvoice
          ? "A paid invoice is linked."
          : "A paid final invoice is still required.",
      },
      {
        key: "completion_photos",
        title: "Completion and quality-control photos",
        status: photos.length > 0 ? "ready" : "missing",
        required: true,
        documentIds: photos.map((photo) => photo.id),
        note:
          photos.length > 0
            ? `${photos.length} photos are available.`
            : "Upload installation and final-condition photos.",
      },
    ];
  }, [invoices, job, materials.length, photos]);

  const warrantyReadiness = useMemo(() => {
    const required = warrantySections.filter((section) => section.required);
    const ready = required.filter((section) => section.status === "ready");
    return required.length ? Math.round((ready.length / required.length) * 100) : 0;
  }, [warrantySections]);

  async function changeStatus(nextStatus: JobStatus) {
    if (!job) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, "jobs", job.id), {
        status: nextStatus,
        updatedAt: serverTimestamp(),
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving(false);
    }
  }

  async function saveNotes() {
    if (!job) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, "jobs", job.id), {
        summaryNotes: notes.trim(),
        updatedAt: serverTimestamp(),
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving(false);
    }
  }

  async function uploadPhoto(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!job || !photoFile) return;
    setPhotoUploading(true);
    setPhotoMessage(null);
    setError(null);
    try {
      const safeName = photoFile.name
        .replace(/\s+/g, "_")
        .replace(/[^\w.-]/g, "");
      const filename = `${Date.now()}_${safeName || "job-photo"}`;
      const fileRef = storageRef(
        getStorage(),
        `jobs/${job.id}/attachments/${filename}`
      );
      await uploadBytes(fileRef, photoFile, {
        contentType: photoFile.type || "image/*",
        customMetadata: {
          jobId: job.id,
          caption: photoCaption.trim(),
        },
      });
      setPhotoFile(null);
      setPhotoCaption("");
      setPhotoMessage(
        "Photo received. It will appear here as soon as processing finishes."
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setPhotoUploading(false);
    }
  }

  async function addMaterial(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!job || !orgId || !selectedMaterialDefinition) {
      setError("Choose a material type before continuing.");
      return;
    }

    const quantity = Number(materialForm.quantity);
    const rate = Number(materialForm.rate);
    const tax = Number(materialForm.tax || 0);
    const delivery = Number(materialForm.delivery || 0);
    const freight = Number(materialForm.freight || 0);
    if (
      !materialForm.description.trim() ||
      !Number.isFinite(quantity) ||
      quantity <= 0 ||
      !Number.isFinite(rate) ||
      rate <= 0
    ) {
      setError(
        `Add a material description, quantity, and rate per ${
          selectedMaterialDefinition.pricingUnit === "SQ" ? "SQ" : "unit"
        }.`
      );
      return;
    }
    if (
      [tax, delivery, freight].some(
        (amount) => !Number.isFinite(amount) || amount < 0
      )
    ) {
      setError("Tax, delivery, and freight must be valid non-negative amounts.");
      return;
    }

    const grossPurchaseCostCents = Math.round(quantity * rate * 100);
    const taxCents = Math.max(0, Math.round(tax * 100));
    const deliveryCents = Math.max(0, Math.round(delivery * 100));
    const freightCents = Math.max(0, Math.round(freight * 100));
    const netActualCostCents =
      grossPurchaseCostCents + taxCents + deliveryCents + freightCents;

    setSaving(true);
    setError(null);
    try {
      const materialRef = doc(collection(db, "jobMaterials"));
      const record: Omit<JobMaterialActual, "id"> = {
        organizationId: orgId,
        jobId: job.id,
        catalogItemId: null,
        materialType: selectedMaterialDefinition.value,
        descriptionSnapshot: materialForm.description.trim(),
        manufacturerSnapshot: materialForm.manufacturer.trim() || null,
        productSnapshot: materialForm.product.trim() || null,
        colorSnapshot: materialForm.color.trim() || null,
        category: selectedMaterialDefinition.category,
        purchaseUnit: selectedMaterialDefinition.pricingUnit,
        orderedQuantity: quantity,
        receivedQuantity: quantity,
        installedQuantity: quantity,
        returnedToSupplierQuantity: 0,
        returnedToInventoryQuantity: 0,
        wastedQuantity: null,
        grossPurchaseCostCents,
        taxCents,
        freightCents,
        deliveryCents,
        stockingCents: 0,
        surchargeCents: 0,
        restockingFeeCents: 0,
        supplierCreditsCents: 0,
        rebatesCents: 0,
        netActualCostCents,
        supplierId: null,
        supplierName: materialForm.supplier.trim() || null,
        supplierInvoiceId: null,
        lotOrBatch: null,
        warrantyComponent: materialForm.warrantyComponent,
        installedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      await setDoc(materialRef, record);
      await updateDoc(doc(db, "jobs", job.id), {
        "expenses.totalMaterialsCents": increment(netActualCostCents),
        "computed.totalExpensesCents": increment(netActualCostCents),
        "computed.netProfitCents": increment(-netActualCostCents),
        updatedAt: serverTimestamp(),
      });
      setMaterialForm(initialMaterialForm);
      setMaterialOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving(false);
    }
  }

  async function prepareWarrantyPacket() {
    if (!job || !orgId) return;
    setSaving(true);
    setError(null);
    try {
      const packetRef = doc(collection(db, "warrantyPackets"));
      await setDoc(packetRef, {
        organizationId: orgId,
        jobId: job.id,
        customerId: job.customer?.id ?? null,
        type:
          job.projectType === "repair"
            ? "RESIDENTIAL_REPAIR_WARRANTY"
            : "RESIDENTIAL_STANDARD_CLOSEOUT",
        version: 1,
        status: warrantyReadiness === 100 ? "ready" : "draft",
        issueDate: new Date().toISOString().slice(0, 10),
        completionDate:
          toDate(
            job.punchedAt || job.shinglesCompletedAt || job.feltCompletedAt
          )
            ?.toISOString()
            .slice(0, 10) ?? null,
        propertyAddressSnapshot: job.address,
        customerNameSnapshot: job.customer?.name || "Property owner",
        sections: warrantySections,
        workmanshipWarrantyId: null,
        manufacturerWarrantyIds: [],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await updateDoc(doc(db, "jobs", job.id), {
        warrantyPacket: {
          lastGeneratedAt: serverTimestamp(),
          lastGeneratedBy: null,
          lastMode: "external",
        },
        updatedAt: serverTimestamp(),
      });
      navigate(`/job/${job.id}/warranty-preview?packet=${packetRef.id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="admin-loading">
        <div>
          <span />
          Loading job workspace…
        </div>
      </div>
    );
  }

  if (!job) {
    return (
      <main className="admin-page">
        <div className="admin-card admin-empty">
          <div>
            <BriefcaseBusiness size={34} />
            <strong>Job not found</strong>
            <p>This project may have been removed or you may not have access.</p>
            <Link className="admin-secondary-button" to="/jobs">
              <ArrowLeft size={15} /> Back to jobs
            </Link>
          </div>
        </div>
      </main>
    );
  }

  const tabs: Array<{
    key: WorkspaceTab;
    label: string;
    icon: typeof BriefcaseBusiness;
    count?: number;
  }> = [
    { key: "overview", label: "Overview", icon: BriefcaseBusiness },
    {
      key: "financials",
      label: "Estimates & invoices",
      icon: FileStack,
      count: estimates.length + invoices.length,
    },
    {
      key: "materials",
      label: "Materials",
      icon: PackageSearch,
      count: materials.length,
    },
    {
      key: "payouts",
      label: "Payouts",
      icon: HandCoins,
      count: payouts.length,
    },
    {
      key: "warranty",
      label: "Warranty",
      icon: ShieldCheck,
    },
    { key: "files", label: "Files & photos", icon: Image, count: photos.length },
  ];

  return (
    <main className="job-workspace-page">
      <header className="job-workspace-header">
        <div className="job-workspace-header-inner">
          <Link to="/jobs" className="job-back-link">
            <ArrowLeft size={16} />
            Jobs
          </Link>
          <div className="job-title-row">
            <div>
              <span className="admin-kicker">{projectLabel(job.projectType)}</span>
              <h1>{addressLine(job)}</h1>
              <p>
                {job.customer?.name || "Customer not linked"}
                {job.customer?.phone ? ` · ${job.customer.phone}` : ""}
              </p>
            </div>
            <div className="job-header-actions">
              <select
                className={`admin-status status-${job.status}`}
                value={job.status}
                disabled={saving}
                onChange={(event) =>
                  changeStatus(event.target.value as JobStatus)
                }
              >
                {[
                  "draft",
                  "pending",
                  "active",
                  "invoiced",
                  "paid",
                  "completed",
                  "closed",
                  "archived",
                ].map((statusOption) => (
                  <option value={statusOption} key={statusOption}>
                    {statusOption}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </header>

      <nav className="job-tabs" aria-label="Job sections">
        <div>
          {tabs.map((item) => {
            const Icon = item.icon;
            return (
              <button
                type="button"
                key={item.key}
                className={tab === item.key ? "is-active" : ""}
                onClick={() => selectTab(item.key)}
              >
                <Icon size={15} />
                {item.label}
                {typeof item.count === "number" && <span>{item.count}</span>}
              </button>
            );
          })}
        </div>
      </nav>

      <div className="job-tab-content">
        {error && <div className="admin-inline-error">{error}</div>}

        {tab === "overview" && (
          <div className="job-overview-layout">
            <section className="job-overview-main">
              <div className="job-health-grid">
                <article>
                  <span>Recorded revenue</span>
                  <strong>{money(financials.revenue)}</strong>
                  <CircleDollarSign />
                </article>
                <article>
                  <span>Total job cost</span>
                  <strong>{money(financials.totalCost)}</strong>
                  <ReceiptText />
                </article>
                <article
                  className={financials.profit < 0 ? "is-negative" : ""}
                >
                  <span>Current profit</span>
                  <strong>{money(financials.profit)}</strong>
                  <BriefcaseBusiness />
                </article>
                <article>
                  <span>Outstanding invoices</span>
                  <strong>{money(financials.outstanding)}</strong>
                  <FileCheck2 />
                </article>
              </div>

              <article className="admin-card job-notes-card">
                <div className="job-card-heading">
                  <div>
                    <span>Internal notes</span>
                    <h2>Project briefing</h2>
                  </div>
                  <button
                    className="admin-secondary-button"
                    type="button"
                    onClick={saveNotes}
                    disabled={saving || notes === (job.summaryNotes || "")}
                  >
                    {saving ? "Saving…" : "Save notes"}
                  </button>
                </div>
                <textarea
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="Add access notes, scope context, customer decisions, or production details."
                />
              </article>

              <article className="admin-card job-production-card">
                <div className="job-card-heading">
                  <div>
                    <span>Production</span>
                    <h2>Schedule and milestones</h2>
                  </div>
                  <Link to="/schedule">
                    Open calendar <ArrowRight size={14} />
                  </Link>
                </div>
                <div className="job-milestones">
                  <div>
                    <span>
                      <CalendarDays size={17} />
                    </span>
                    <div>
                      <small>Felt / dry-in</small>
                      <strong>{formatDate(job.feltScheduledFor)}</strong>
                      <em>
                        {job.feltCompletedAt
                          ? `Completed ${formatDate(job.feltCompletedAt)}`
                          : "Not marked complete"}
                      </em>
                    </div>
                  </div>
                  <div>
                    <span>
                      <CalendarDays size={17} />
                    </span>
                    <div>
                      <small>Roof installation</small>
                      <strong>{formatDate(job.shinglesScheduledFor)}</strong>
                      <em>
                        {job.shinglesCompletedAt
                          ? `Completed ${formatDate(job.shinglesCompletedAt)}`
                          : "Not marked complete"}
                      </em>
                    </div>
                  </div>
                  <div>
                    <span>
                      <ClipboardCheck size={17} />
                    </span>
                    <div>
                      <small>Final punch</small>
                      <strong>{formatDate(job.punchScheduledFor)}</strong>
                      <em>
                        {job.punchedAt
                          ? `Completed ${formatDate(job.punchedAt)}`
                          : "Not marked complete"}
                      </em>
                    </div>
                  </div>
                </div>
              </article>
            </section>

            <aside className="job-overview-aside">
              <article className="admin-card job-contact-card">
                <div className="job-card-heading">
                  <div>
                    <span>Customer</span>
                    <h2>Contact details</h2>
                  </div>
                </div>
                <div className="job-contact-details">
                  <div>
                    <span>
                      <Users size={16} />
                    </span>
                    <p>
                      <small>Customer</small>
                      <strong>{job.customer?.name || "Not linked"}</strong>
                    </p>
                  </div>
                  <div>
                    <span>
                      <MapPin size={16} />
                    </span>
                    <p>
                      <small>Property</small>
                      <strong>{addressLine(job)}</strong>
                    </p>
                  </div>
                  {job.customer?.phone && (
                    <a href={`tel:${job.customer.phone}`}>
                      <span>
                        <Phone size={16} />
                      </span>
                      <p>
                        <small>Phone</small>
                        <strong>{job.customer.phone}</strong>
                      </p>
                    </a>
                  )}
                  {job.customer?.email && (
                    <a href={`mailto:${job.customer.email}`}>
                      <span>
                        <Mail size={16} />
                      </span>
                      <p>
                        <small>Email</small>
                        <strong>{job.customer.email}</strong>
                      </p>
                    </a>
                  )}
                </div>
              </article>

              <article className="admin-card job-crew-card">
                <div className="job-card-heading">
                  <div>
                    <span>Assigned crew</span>
                    <h2>Members</h2>
                  </div>
                  <Link to="/employees">Manage</Link>
                </div>
                {assignedEmployees.length === 0 ? (
                  <div className="job-mini-empty">No members assigned.</div>
                ) : (
                  <div className="job-assigned-list">
                    {assignedEmployees.map((employee) => (
                      <Link to={`/employees/${employee.id}`} key={employee.id}>
                        <span>{employee.name.charAt(0)}</span>
                        <p>
                          <strong>{employee.name}</strong>
                          <small>{employee.role || "member"}</small>
                        </p>
                        <ArrowRight size={14} />
                      </Link>
                    ))}
                  </div>
                )}
              </article>
            </aside>
          </div>
        )}

        {tab === "financials" && (
          <div className="job-section-layout">
            <section className="job-section-main">
              <div className="job-financial-summary">
                <article>
                  <span>Estimate pipeline</span>
                  <strong>{estimates.length}</strong>
                  <small>
                    {estimates.filter((estimate) => estimate.status === "accepted")
                      .length}{" "}
                    accepted
                  </small>
                </article>
                <article>
                  <span>Invoice total</span>
                  <strong>
                    {money(
                      invoices.reduce(
                        (sum, invoice) =>
                          sum + (invoice.money?.totalCents ?? 0),
                        0
                      )
                    )}
                  </strong>
                  <small>{invoices.length} documents</small>
                </article>
                <article>
                  <span>Outstanding</span>
                  <strong>{money(financials.outstanding)}</strong>
                  <small>Based on current invoice status</small>
                </article>
              </div>

              <article className="admin-card job-document-list">
                <div className="job-card-heading">
                  <div>
                    <span>Customer documents</span>
                    <h2>Estimates and invoices</h2>
                  </div>
                  {estimates.length === 0 && (
                    <Link
                      className="admin-primary-button"
                      to={`/estimates/new?jobId=${job.id}`}
                    >
                      <Plus size={14} />
                      Create estimate
                    </Link>
                  )}
                </div>
                {estimates.length + invoices.length === 0 ? (
                  <div className="admin-empty">
                    <div>
                      <FileStack size={32} />
                      <strong>No documents yet</strong>
                      <p>
                        Create a detailed estimate first, then preserve accepted
                        versions and issued invoices as snapshots.
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="job-documents">
                    {estimates.map((estimate) => (
                      <article className="job-document-row" key={estimate.id}>
                        <span>
                          <FileStack size={17} />
                        </span>
                        <p>
                          <strong>
                            {estimate.number || `Estimate v${estimate.version}`}
                          </strong>
                          <small>
                            Estimate · Version {estimate.version} · Updated {formatDate(estimate.updatedAt || estimate.createdAt)}
                          </small>
                        </p>
                        <b>{money(estimate.totalCents)}</b>
                        <span className={`admin-status status-${estimate.status}`}>
                          {ESTIMATE_STATUS_LABELS[estimate.status]}
                        </span>
                        <div className="job-document-actions">
                          {estimate.status !== "lead_received" && (
                            <Link
                              to={`/estimate/${estimate.id}`}
                              aria-label={`View ${estimate.number || "estimate"}`}
                            >
                              <Eye size={14} /> View
                            </Link>
                          )}
                          <Link
                            to={`/estimates/${estimate.id}/edit`}
                            aria-label={`Edit ${estimate.number || "estimate"}`}
                          >
                            <Pencil size={14} />
                            {estimate.status === "lead_received"
                              ? "Set up"
                              : "Edit"}
                          </Link>
                        </div>
                      </article>
                    ))}
                    {invoices.map((invoice) => (
                      <article className="job-document-row" key={invoice.id}>
                        <span>
                          <ReceiptText size={17} />
                        </span>
                        <p>
                          <strong>{invoice.number || "Invoice"}</strong>
                          <small>{formatDate(invoice.createdAt)}</small>
                        </p>
                        <b>{money(invoice.money?.totalCents ?? 0)}</b>
                        <span className={`admin-status status-${invoice.status}`}>
                          {invoice.status}
                        </span>
                        <div className="job-document-actions">
                          <Link to={`/invoices/${invoice.id}`}>
                            <Eye size={14} /> View
                          </Link>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </article>
            </section>
            <aside className="admin-card job-document-guidance">
              <span className="admin-kicker">Document discipline</span>
              <h2>Keep each record distinct.</h2>
              <ul>
                <li>
                  <Check /> Estimates are versioned expectations—not final
                  invoices.
                </li>
                <li>
                  <Check /> Accepted scopes freeze before contract generation.
                </li>
                <li>
                  <Check /> Issued invoices reflect contract, change orders, and
                  payments.
                </li>
                <li>
                  <Check /> Warranty closeout includes the governing files, not
                  just a summary.
                </li>
              </ul>
              <Link className="admin-secondary-button" to="/invoices-page">
                Open document center <ArrowRight size={14} />
              </Link>
            </aside>
          </div>
        )}

        {tab === "materials" && (
          <div className="job-section-layout">
            <section className="admin-card job-materials-card">
              <div className="job-card-heading">
                <div>
                  <span>Actual job cost</span>
                  <h2>Materials used on this project</h2>
                </div>
                <button
                  className="admin-primary-button"
                  type="button"
                  onClick={openMaterialForm}
                >
                  <Plus size={14} />
                  Add material expense
                </button>
              </div>
              <div className="job-material-summary">
                <div>
                  <span>Product cost</span>
                  <strong>
                    {money(
                      materials.reduce(
                        (sum, material) =>
                          sum + material.grossPurchaseCostCents,
                        0
                      )
                    )}
                  </strong>
                </div>
                <div>
                  <span>Tax, freight & delivery</span>
                  <strong>
                    {money(
                      materials.reduce(
                        (sum, material) =>
                          sum +
                          material.taxCents +
                          material.freightCents +
                          material.deliveryCents,
                        0
                      )
                    )}
                  </strong>
                </div>
                <div>
                  <span>Net actual cost</span>
                  <strong>{money(financials.materialCost)}</strong>
                </div>
              </div>
              {materials.length === 0 ? (
                <div className="admin-empty">
                  <div>
                    <PackageSearch size={32} />
                    <strong>No job materials recorded</strong>
                    <p>
                      Add purchased quantities, unit cost, delivery, tax, and
                      warranty relevance without inventing market prices.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="job-material-table-wrap">
                  <table className="admin-table job-material-table">
                    <thead>
                      <tr>
                        <th>Material</th>
                        <th>Ordered</th>
                        <th>Received</th>
                        <th>Installed</th>
                        <th>Product cost</th>
                        <th>Add-ons</th>
                        <th>Net cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {materials.map((material) => (
                        <tr key={material.id}>
                          <td>
                            <div className="admin-table-stack">
                              <strong>{material.descriptionSnapshot}</strong>
                              <small>
                                {[
                                  material.manufacturerSnapshot,
                                  material.productSnapshot,
                                  material.colorSnapshot,
                                ]
                                  .filter(Boolean)
                                  .join(" · ") || "No product snapshot"}
                              </small>
                            </div>
                          </td>
                          <td>
                            {material.orderedQuantity} {material.purchaseUnit}
                          </td>
                          <td>{material.receivedQuantity}</td>
                          <td>{material.installedQuantity ?? "—"}</td>
                          <td>{money(material.grossPurchaseCostCents)}</td>
                          <td>
                            {money(
                              material.taxCents +
                                material.freightCents +
                                material.deliveryCents +
                                material.stockingCents +
                                material.surchargeCents
                            )}
                          </td>
                          <td>
                            <strong>{money(material.netActualCostCents)}</strong>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
            <aside className="admin-card job-material-guidance">
              <span className="admin-kicker">Material controls</span>
              <h2>Actual cost is more than unit price.</h2>
              <p>
                Net job cost includes product cost, applicable tax, freight,
                delivery, stocking, surcharges, and restocking—less supplier
                credits and rebates.
              </p>
              <dl>
                <div>
                  <dt>Estimated</dt>
                  <dd>Planned takeoff and cost snapshot</dd>
                </div>
                <div>
                  <dt>Actual</dt>
                  <dd>Ordered, received, installed, returned, and credited</dd>
                </div>
                <div>
                  <dt>Warranty</dt>
                  <dd>Exact product, lot, supplier, and evidence</dd>
                </div>
              </dl>
              <div className="job-material-guidance-note">
                <PackageCheck size={16} />
                Materials are recorded directly on this job so quantities and
                costs stay tied to the property.
              </div>
            </aside>
          </div>
        )}

        {tab === "payouts" && (
          <section className="admin-card job-payouts-card">
            <div className="job-card-heading">
              <div>
                <span>Job labor</span>
                <h2>Payout history</h2>
              </div>
              <Link className="admin-primary-button" to={`/payouts?jobId=${job.id}`}>
                <Plus size={14} />
                Record payout
              </Link>
            </div>
            <div className="job-payout-total">
              <span>Total worker payouts on this job</span>
              <strong>{money(financials.payoutCost)}</strong>
            </div>
            {payouts.length === 0 ? (
              <div className="admin-empty">
                <div>
                  <HandCoins size={32} />
                  <strong>No job-linked payouts</strong>
                  <p>
                    Record worker payments against this property to preserve
                    accurate payroll history and job profit.
                  </p>
                </div>
              </div>
            ) : (
              <div className="job-payout-table-wrap">
                <table className="admin-table job-payout-table">
                  <thead>
                    <tr>
                      <th>Member</th>
                      <th>Category</th>
                      <th>Method</th>
                      <th>Created</th>
                      <th>Paid</th>
                      <th>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payouts.map((payout) => (
                      <tr key={payout.id}>
                        <td>
                          <strong>{payout.employeeNameSnapshot}</strong>
                        </td>
                        <td>{payout.category}</td>
                        <td>{payout.method}</td>
                        <td>{formatDate(payout.createdAt)}</td>
                        <td>
                          <span
                            className={
                              payout.paidAt
                                ? "admin-status status-paid"
                                : "admin-status status-pending"
                            }
                          >
                            {payout.paidAt ? "Paid" : "Awaiting"}
                          </span>
                        </td>
                        <td>
                          <strong>{money(payout.amountCents)}</strong>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {tab === "warranty" && (
          <div className="job-section-layout">
            <section className="admin-card warranty-readiness-card">
              <div className="job-card-heading">
                <div>
                  <span>Closeout packet</span>
                  <h2>Warranty readiness</h2>
                </div>
                <button
                  className="admin-primary-button"
                  type="button"
                  disabled={saving}
                  onClick={prepareWarrantyPacket}
                >
                  {saving ? "Preparing…" : "Prepare packet"}
                  {!saving && <ArrowRight size={14} />}
                </button>
              </div>
              <div className="warranty-score">
                <div
                  className="warranty-score-ring"
                  style={{
                    background: `conic-gradient(var(--red) ${warrantyReadiness}%, #e8e3da 0)`,
                  }}
                >
                  <span>{warrantyReadiness}%</span>
                </div>
                <div>
                  <strong>
                    {warrantyReadiness === 100
                      ? "Required sections are ready."
                      : "Closeout still needs attention."}
                  </strong>
                  <p>
                    A warranty packet is a document bundle. Contractor
                    workmanship coverage and manufacturer coverage remain
                    separate records.
                  </p>
                </div>
              </div>
              <div className="warranty-checklist">
                {warrantySections.map((section) => (
                  <div key={section.key}>
                    <span className={`warranty-state is-${section.status}`}>
                      {section.status === "ready" ? (
                        <Check size={14} />
                      ) : (
                        "!"
                      )}
                    </span>
                    <p>
                      <strong>{section.title}</strong>
                      <small>{section.note}</small>
                    </p>
                    <em>{section.required ? "Required" : "Optional"}</em>
                  </div>
                ))}
              </div>
            </section>
            <aside className="admin-card warranty-summary-card">
              <span className="admin-kicker">Warranty record</span>
              <h2>
                {job.warranty?.programName ||
                  job.warranty?.manufacturer ||
                  "Coverage not configured"}
              </h2>
              <dl>
                <div>
                  <dt>Type</dt>
                  <dd>{job.warranty?.kind || "Not set"}</dd>
                </div>
                <div>
                  <dt>Status</dt>
                  <dd>{job.warranty?.status || "Not started"}</dd>
                </div>
                <div>
                  <dt>Term</dt>
                  <dd>
                    {job.warranty?.coverageYears
                      ? `${job.warranty.coverageYears} years`
                      : "Needs definition"}
                  </dd>
                </div>
                <div>
                  <dt>Registration</dt>
                  <dd>{job.warranty?.registrationId || "Not recorded"}</dd>
                </div>
              </dl>
              <p>
                Manufacturer summaries are informational. The attached governing
                manufacturer warranty controls if a summary conflicts with it.
              </p>
            </aside>
          </div>
        )}

        {tab === "files" && (
          <section className="admin-card job-files-card">
            <div className="job-card-heading">
              <div>
                <span>Project evidence</span>
                <h2>Files and photos</h2>
              </div>
              <label className="admin-secondary-button job-upload-button">
                <UploadCloud size={15} />
                Add photos
                <input
                  type="file"
                  accept="image/*"
                  onChange={(event) => {
                    setPhotoFile(event.target.files?.[0] ?? null);
                    setPhotoMessage(null);
                    event.currentTarget.value = "";
                  }}
                />
              </label>
            </div>
            {photoFile && (
              <form className="job-upload-panel" onSubmit={uploadPhoto}>
                <div>
                  <UploadCloud size={18} />
                  <p>
                    <strong>{photoFile.name}</strong>
                    <small>Ready to attach to this job</small>
                  </p>
                </div>
                <input
                  value={photoCaption}
                  onChange={(event) => setPhotoCaption(event.target.value)}
                  placeholder="Optional caption, e.g. completed ridge line"
                  maxLength={200}
                  aria-label="Photo caption"
                />
                <button
                  type="button"
                  className="admin-icon-button"
                  onClick={() => {
                    setPhotoFile(null);
                    setPhotoCaption("");
                  }}
                  aria-label="Remove selected photo"
                >
                  <X size={16} />
                </button>
                <button
                  type="submit"
                  className="admin-primary-button"
                  disabled={photoUploading}
                >
                  {photoUploading ? "Uploading…" : "Upload photo"}
                </button>
              </form>
            )}
            {photoMessage && (
              <p className="job-upload-message" role="status">
                <Check size={15} /> {photoMessage}
              </p>
            )}
            {photos.length === 0 ? (
              <div className="admin-empty">
                <div>
                  <Image size={32} />
                  <strong>No project photos</strong>
                  <p>
                    Add inspection, tear-off, deck, flashing, installation, and
                    completion photos to strengthen the job record.
                  </p>
                </div>
              </div>
            ) : (
              <div className="job-photo-grid">
                {photos.map((photo) => (
                  <a
                    href={photo.url}
                    target="_blank"
                    rel="noreferrer"
                    key={photo.id}
                  >
                    <img src={photo.url} alt={photo.caption || "Job photo"} />
                    <span>{photo.caption || "Project photo"}</span>
                  </a>
                ))}
              </div>
            )}
          </section>
        )}
      </div>

      {materialOpen && (
        <>
          <button
            className="admin-drawer-scrim"
            type="button"
            onClick={closeMaterialForm}
            aria-label="Close material form"
          />
          <aside
            className="admin-drawer material-form-drawer"
            aria-label="Add a material expense"
          >
            <div className="admin-drawer-header">
              <div>
                <span>Job cost</span>
                <h2>Add material expense</h2>
              </div>
              <button type="button" onClick={closeMaterialForm} aria-label="Close">
                ×
              </button>
            </div>
            <form onSubmit={addMaterial}>
              <section className="drawer-form-section material-type-section">
                <div className="drawer-form-heading">
                  <span>01</span>
                  <div>
                    <strong>Choose the material type</strong>
                    <small>
                      This sets the correct quantity and pricing method.
                    </small>
                  </div>
                </div>
                <label>
                  Material type *
                  <select
                    required
                    value={materialForm.materialType}
                    onChange={(event) =>
                      selectMaterialType(
                        event.target.value as RoofingMaterialType
                      )
                    }
                  >
                    <option value="" disabled>
                      Select a material type
                    </option>
                    {ROOFING_MATERIAL_DEFINITIONS.map((definition) => (
                      <option value={definition.value} key={definition.value}>
                        {definition.label}
                      </option>
                    ))}
                  </select>
                </label>

                {selectedMaterialDefinition ? (
                  <div className="material-type-guidance" aria-live="polite">
                    <span>
                      {selectedMaterialDefinition.pricingUnit === "SQ" ? (
                        <Ruler size={18} />
                      ) : (
                        <PackageCheck size={18} />
                      )}
                    </span>
                    <div>
                      <strong>
                        {selectedMaterialDefinition.pricingUnit === "SQ"
                          ? "Measured and priced by SQ"
                          : "Measured and priced per unit"}
                      </strong>
                      <p>{selectedMaterialDefinition.description}</p>
                      {selectedMaterialDefinition.pricingUnit === "SQ" && (
                        <small>1 roofing SQ = 100 square feet</small>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="material-type-placeholder">
                    <Ruler size={18} />
                    Select a type to reveal the matching product and cost fields.
                  </div>
                )}
              </section>

              {selectedMaterialDefinition && (
                <>
                  <section className="drawer-form-section">
                    <div className="drawer-form-heading">
                      <span>02</span>
                      <div>
                        <strong>Product details</strong>
                        <small>
                          Preserve the exact material used on this property.
                        </small>
                      </div>
                    </div>
                    <label>
                      Material description *
                      <input
                        required
                        value={materialForm.description}
                        onChange={(event) =>
                          setMaterialForm((current) => ({
                            ...current,
                            description: event.target.value,
                          }))
                        }
                        placeholder={selectedMaterialDefinition.label}
                      />
                    </label>
                    <div className="drawer-form-grid">
                      <label>
                        Manufacturer
                        <input
                          value={materialForm.manufacturer}
                          onChange={(event) =>
                            setMaterialForm((current) => ({
                              ...current,
                              manufacturer: event.target.value,
                            }))
                          }
                          placeholder="e.g. IKO, Tamko"
                        />
                      </label>
                      <label>
                        Product / line
                        <input
                          value={materialForm.product}
                          onChange={(event) =>
                            setMaterialForm((current) => ({
                              ...current,
                              product: event.target.value,
                            }))
                          }
                          placeholder="e.g. Cambridge"
                        />
                      </label>
                    </div>
                    <label>
                      Color / finish
                      <input
                        value={materialForm.color}
                        onChange={(event) =>
                          setMaterialForm((current) => ({
                            ...current,
                            color: event.target.value,
                          }))
                        }
                        placeholder="e.g. Dual Black"
                      />
                    </label>
                  </section>

                  <section className="drawer-form-section">
                    <div className="drawer-form-heading">
                      <span>03</span>
                      <div>
                        <strong>Quantity and price</strong>
                        <small>
                          Enter the actual quantity purchased and supplier rate.
                        </small>
                      </div>
                    </div>
                    <div className="drawer-form-grid material-pricing-fields">
                      <label>
                        {selectedMaterialDefinition.pricingUnit === "SQ"
                          ? "Quantity (SQ) *"
                          : "Quantity (units) *"}
                        <div className="material-rate-input">
                          <Ruler size={17} />
                          <input
                            required
                            type="number"
                            min="0.01"
                            step="0.01"
                            inputMode="decimal"
                            value={materialForm.quantity}
                            onChange={(event) =>
                              setMaterialForm((current) => ({
                                ...current,
                                quantity: event.target.value,
                              }))
                            }
                            placeholder="0"
                          />
                          <span>
                            {selectedMaterialDefinition.pricingUnit === "SQ"
                              ? "SQ"
                              : "units"}
                          </span>
                        </div>
                      </label>
                      <label>
                        {selectedMaterialDefinition.pricingUnit === "SQ"
                          ? "Price per SQ ($) *"
                          : "Price per unit ($) *"}
                        <div className="material-rate-input">
                          <CircleDollarSign size={17} />
                          <input
                            required
                            type="number"
                            min="0.01"
                            step="0.01"
                            inputMode="decimal"
                            value={materialForm.rate}
                            onChange={(event) =>
                              setMaterialForm((current) => ({
                                ...current,
                                rate: event.target.value,
                              }))
                            }
                            placeholder="0.00"
                          />
                          <span>
                            / {selectedMaterialDefinition.pricingUnit === "SQ"
                              ? "SQ"
                              : "unit"}
                          </span>
                        </div>
                      </label>
                    </div>
                    <div className="material-pricing-note">
                      <Ruler size={16} />
                      {selectedMaterialDefinition.pricingUnit === "SQ"
                        ? "The quantity in SQ is multiplied by the price per SQ."
                        : "The unit quantity is multiplied by the price per unit."}
                    </div>
                  </section>

                  <section className="drawer-form-section">
                    <div className="drawer-form-heading">
                      <span>04</span>
                      <div>
                        <strong>Purchase details</strong>
                        <small>
                          Add supplier charges that belong in the actual job cost.
                        </small>
                      </div>
                    </div>
                    <div className="drawer-form-grid drawer-form-grid-three">
                      <label>
                        Tax ($)
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          inputMode="decimal"
                          value={materialForm.tax}
                          onChange={(event) =>
                            setMaterialForm((current) => ({
                              ...current,
                              tax: event.target.value,
                            }))
                          }
                          placeholder="0.00"
                        />
                      </label>
                      <label>
                        Delivery ($)
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          inputMode="decimal"
                          value={materialForm.delivery}
                          onChange={(event) =>
                            setMaterialForm((current) => ({
                              ...current,
                              delivery: event.target.value,
                            }))
                          }
                          placeholder="0.00"
                        />
                      </label>
                      <label>
                        Freight ($)
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          inputMode="decimal"
                          value={materialForm.freight}
                          onChange={(event) =>
                            setMaterialForm((current) => ({
                              ...current,
                              freight: event.target.value,
                            }))
                          }
                          placeholder="0.00"
                        />
                      </label>
                    </div>
                    <label>
                      Supplier
                      <input
                        value={materialForm.supplier}
                        onChange={(event) =>
                          setMaterialForm((current) => ({
                            ...current,
                            supplier: event.target.value,
                          }))
                        }
                        placeholder="e.g. Alamo Roofing Supplies"
                      />
                    </label>
                    <label className="job-material-warranty-check">
                      <input
                        type="checkbox"
                        checked={materialForm.warrantyComponent}
                        onChange={(event) =>
                          setMaterialForm((current) => ({
                            ...current,
                            warrantyComponent: event.target.checked,
                          }))
                        }
                      />
                      Required component for the selected warranty program
                    </label>

                    <div className="material-expense-preview" aria-live="polite">
                      <div>
                        <span>Product cost</span>
                        <strong>
                          {money(Math.round(materialProductCostPreview * 100))}
                        </strong>
                      </div>
                      <div>
                        <span>Tax, delivery & freight</span>
                        <strong>
                          {money(Math.round(materialAddOnsPreview * 100))}
                        </strong>
                      </div>
                      <div>
                        <span>Actual material cost</span>
                        <strong>
                          {money(
                            Math.round(
                              (materialProductCostPreview +
                                materialAddOnsPreview) *
                                100
                            )
                          )}
                        </strong>
                      </div>
                    </div>
                  </section>
                </>
              )}

              {error && <div className="admin-inline-error">{error}</div>}
              <div className="admin-drawer-actions">
                <button
                  className="admin-primary-button"
                  type="submit"
                  disabled={saving || !selectedMaterialDefinition}
                >
                  {saving ? "Adding material…" : "Add material to job"}
                  {!saving && <ArrowRight size={16} />}
                </button>
              </div>
            </form>
          </aside>
        </>
      )}
    </main>
  );
}
