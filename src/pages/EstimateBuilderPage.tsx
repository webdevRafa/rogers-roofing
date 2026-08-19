import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Calculator,
  Check,
  Eye,
  FileText,
  Loader2,
  Mail,
  Plus,
  Ruler,
  Save,
  Send,
  Trash2,
} from "lucide-react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";

import { useOrg } from "../contexts/OrgContext";
import { estimateLineItemsFromJobMaterials } from "../domain/estimateMaterials";
import { db, functions } from "../firebase/firebaseConfig";
import type {
  EstimateLineItem,
  EstimateRecord,
  EstimateStatus,
  JobMaterialActual,
  RoofMeasurement,
  RoofingUnit,
} from "../domain/roofing";
import type { Address, Job, Org } from "../types/types";

type EditorMeasurement = {
  id: string;
  length: string;
  width: string;
};

type FormState = {
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  projectTitle: string;
  issueDate: string;
  validUntil: string;
  taxRate: string;
  discount: string;
  deposit: string;
  paymentTerms: string;
  warrantyText: string;
  notes: string;
  assumptions: string;
  exclusions: string;
};

type SaveMode = "draft" | "preview" | "send";

const unitLabels: Record<RoofingUnit, string> = {
  EA: "Each",
  PIECE: "Piece",
  BOX: "Box",
  SQ: "Square",
  SF: "Sq. ft.",
  LF: "Lin. ft.",
  HR: "Hour",
  DAY: "Day",
  LS: "Lump sum",
  TON: "Ton",
  SHEET: "Sheet",
  GAL: "Gallon",
  ROLL: "Roll",
  BUNDLE: "Bundle",
  OTHER: "Other",
};

function dateInput(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(value: Date, days: number) {
  const next = new Date(value);
  next.setDate(next.getDate() + days);
  return next;
}

function initialForm(): FormState {
  const today = new Date();
  return {
    customerName: "",
    customerEmail: "",
    customerPhone: "",
    projectTitle: "Roof replacement estimate",
    issueDate: dateInput(today),
    validUntil: dateInput(addDays(today, 30)),
    taxRate: "0",
    discount: "0",
    deposit: "0",
    paymentTerms:
      "Payment schedule will be confirmed with the customer before work begins.",
    warrantyText:
      "One-year workmanship warranty covering leaks, blown shingles, and installation-related seal failure. Manufacturer warranties remain subject to their published terms.",
    notes:
      "Final quantities may be adjusted if concealed decking damage or other unforeseen conditions are discovered after tear-off.",
    assumptions: "Property access will be available during scheduled work.",
    exclusions:
      "Structural repairs, permits, and concealed damage are excluded unless specifically listed above.",
  };
}

function newMeasurement(
  overrides: Partial<EditorMeasurement> = {}
): EditorMeasurement {
  return {
    id: crypto.randomUUID(),
    length: "",
    width: "",
    ...overrides,
  };
}

function positiveNumber(value: string) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

function roundMeasurement(value: number) {
  return Math.round(value * 100) / 100;
}

function measurementArea(measurement: EditorMeasurement) {
  return roundMeasurement(
    positiveNumber(measurement.length) * positiveNumber(measurement.width)
  );
}

function formatMeasurement(value: number, maximumFractionDigits = 2) {
  return value.toLocaleString("en-US", {
    maximumFractionDigits,
  });
}

function centsFromInput(value: string) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.round(number * 100)) : 0;
}

function money(cents: number) {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

function jobAddress(job: Job) {
  if (typeof job.address === "string") return job.address;
  return job.address?.fullLine || "Address not added";
}

function addressSnapshot(job: Job): Address {
  if (typeof job.address === "string") {
    return { fullLine: job.address, street: job.address, country: "US" };
  }
  return job.address;
}

function projectTypeLabel(type?: Job["projectType"]) {
  const labels: Record<NonNullable<Job["projectType"]>, string> = {
    replacement: "Roof replacement estimate",
    repair: "Roof repair estimate",
    storm_restoration: "Storm restoration estimate",
    new_install: "New roof installation estimate",
    commercial: "Commercial roofing estimate",
    maintenance: "Roof maintenance estimate",
  };
  return type ? labels[type] : "Roofing project estimate";
}

function splitLines(value: string) {
  return value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

function timestampToDateInput(value: unknown) {
  if (!value) return "";
  if (value instanceof Date) return dateInput(value);
  const maybeTimestamp = value as { toDate?: () => Date };
  return typeof maybeTimestamp.toDate === "function"
    ? dateInput(maybeTimestamp.toDate())
    : "";
}

export default function EstimateBuilderPage() {
  const { id } = useParams<{ id?: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { orgId, orgName } = useOrg();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selectedJobId, setSelectedJobId] = useState(
    searchParams.get("jobId") || ""
  );
  const [form, setForm] = useState<FormState>(initialForm);
  const [jobMaterials, setJobMaterials] = useState<JobMaterialActual[]>([]);
  const [materialSyncReady, setMaterialSyncReady] = useState(false);
  const [measurements, setMeasurements] = useState<EditorMeasurement[]>([
    newMeasurement(),
  ]);
  const [measurementsFinalized, setMeasurementsFinalized] = useState(false);
  const [organization, setOrganization] = useState<
    NonNullable<EstimateRecord["organizationSnapshot"]>
  >({ name: orgName || "Roger's Roofing" });
  const [existing, setExisting] = useState<EstimateRecord | null>(null);
  const [loading, setLoading] = useState(Boolean(id));
  const [savingMode, setSavingMode] = useState<SaveMode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const initializedJob = useRef(false);

  useEffect(() => {
    if (!orgId) return;
    const jobsQuery = query(
      collection(db, "jobs"),
      where("orgId", "==", orgId)
    );
    return onSnapshot(jobsQuery, (snapshot) => {
      const nextJobs = snapshot.docs.map((snapshotDocument) => ({
        id: snapshotDocument.id,
        ...(snapshotDocument.data() as Omit<Job, "id">),
      }));
      nextJobs.sort((a, b) => jobAddress(a).localeCompare(jobAddress(b)));
      setJobs(nextJobs);
      setSelectedJobId((current) => current || nextJobs[0]?.id || "");
    });
  }, [orgId]);

  useEffect(() => {
    if (!orgId) return;
    void getDoc(doc(db, "organizations", orgId)).then((snapshot) => {
      if (!snapshot.exists()) {
        setOrganization({ name: orgName || "Roger's Roofing" });
        return;
      }
      const data = snapshot.data() as Partial<Org>;
      setOrganization({
        name: data.name || orgName || "Roger's Roofing",
        ...(data.legalName ? { legalName: data.legalName } : {}),
        ...(data.phone ? { phone: data.phone } : {}),
        ...(data.email ? { email: data.email } : {}),
        ...(data.address ? { address: data.address } : {}),
        ...(data.logoUrl ? { logoUrl: data.logoUrl } : {}),
      });
    });
  }, [orgId, orgName]);

  useEffect(() => {
    if (!id) return;
    void getDoc(doc(db, "estimates", id))
      .then((snapshot) => {
        if (!snapshot.exists()) throw new Error("Estimate not found.");
        const estimate = {
          id: snapshot.id,
          ...(snapshot.data() as Omit<EstimateRecord, "id">),
        };
        setExisting(estimate);
        setSelectedJobId(estimate.jobId);
        setOrganization(
          estimate.organizationSnapshot || {
            name: orgName || "Roger's Roofing",
          }
        );
        setForm({
          customerName: estimate.customerSnapshot?.name || "",
          customerEmail: estimate.customerSnapshot?.email || "",
          customerPhone: estimate.customerSnapshot?.phone || "",
          projectTitle: estimate.projectTitle || "Roofing project estimate",
          issueDate:
            estimate.issueDate ||
            timestampToDateInput(estimate.createdAt) ||
            dateInput(new Date()),
          validUntil: estimate.validUntil || "",
          taxRate: String(estimate.taxRatePercent ?? 0),
          discount: String((estimate.discountCents ?? 0) / 100),
          deposit: String((estimate.depositCents ?? 0) / 100),
          paymentTerms: estimate.paymentTerms || "",
          warrantyText: estimate.warrantyText || "",
          notes: estimate.notes || "",
          assumptions: estimate.assumptions.join("\n"),
          exclusions: estimate.exclusions.join("\n"),
        });
        const savedMeasurements = estimate.roofMeasurements || [];
        setMeasurements(
          savedMeasurements.length > 0
            ? savedMeasurements.map((measurement) => ({
                id: measurement.id,
                length: String(measurement.lengthFt),
                width: String(measurement.widthFt),
              }))
            : [newMeasurement()]
        );
        setMeasurementsFinalized(
          Boolean(estimate.measurementsFinalized && savedMeasurements.length)
        );
        initializedJob.current = true;
      })
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : String(caught));
      })
      .finally(() => setLoading(false));
  }, [id, orgName]);

  useEffect(() => {
    if (id || initializedJob.current || !selectedJobId || jobs.length === 0) {
      return;
    }
    const job = jobs.find((item) => item.id === selectedJobId);
    if (!job) return;
    setForm((current) => ({
      ...current,
      customerName: job.customer?.name || current.customerName,
      customerEmail: job.customer?.email || current.customerEmail,
      customerPhone: job.customer?.phone || current.customerPhone,
      projectTitle: projectTypeLabel(job.projectType),
    }));
    initializedJob.current = true;
  }, [id, jobs, selectedJobId]);

  const selectedJob = useMemo(
    () => jobs.find((job) => job.id === selectedJobId) || null,
    [jobs, selectedJobId]
  );

  useEffect(() => {
    setJobMaterials([]);
    setMaterialSyncReady(false);
    if (!selectedJobId) return;

    return onSnapshot(
      query(
        collection(db, "jobMaterials"),
        where("jobId", "==", selectedJobId)
      ),
      (snapshot) => {
        const nextMaterials = snapshot.docs.map((snapshotDocument) => ({
          id: snapshotDocument.id,
          ...(snapshotDocument.data() as Omit<JobMaterialActual, "id">),
        }));
        setJobMaterials(nextMaterials);
        setMaterialSyncReady(true);
      },
      (snapshotError) => {
        setError(snapshotError.message);
        setMaterialSyncReady(true);
      }
    );
  }, [selectedJobId]);

  const syncedMaterialLines = useMemo(
    () => estimateLineItemsFromJobMaterials(jobMaterials),
    [jobMaterials]
  );
  const usingSavedSnapshot =
    materialSyncReady &&
    syncedMaterialLines.length === 0 &&
    existing?.jobId === selectedJobId &&
    existing.lineItems.length > 0;
  const lines = useMemo(
    () =>
      syncedMaterialLines.length > 0
        ? syncedMaterialLines
        : existing?.jobId === selectedJobId
          ? existing.lineItems
          : [],
    [existing, selectedJobId, syncedMaterialLines]
  );

  const totals = useMemo(() => {
    const subtotalCents = lines.reduce((sum, line) => {
      if (
        line.pricingMode === "included" ||
        line.pricingMode === "no_charge"
      ) {
        return sum;
      }
      return sum + Math.max(0, line.lineTotalCents);
    }, 0);
    const discountCents = Math.min(
      subtotalCents,
      centsFromInput(form.discount)
    );
    const taxableCents = Math.max(0, subtotalCents - discountCents);
    const taxRate = Math.max(0, Number(form.taxRate) || 0);
    const taxCents = Math.round(taxableCents * (taxRate / 100));
    const totalCents = taxableCents + taxCents;
    return {
      subtotalCents,
      discountCents,
      taxCents,
      totalCents,
      depositCents: Math.min(totalCents, centsFromInput(form.deposit)),
    };
  }, [form.deposit, form.discount, form.taxRate, lines]);

  const measurementTotals = useMemo(() => {
    const completed = measurements.filter(
      (measurement) =>
        positiveNumber(measurement.length) > 0 &&
        positiveNumber(measurement.width) > 0
    );
    const squareFeet = roundMeasurement(
      completed.reduce(
        (total, measurement) => total + measurementArea(measurement),
        0
      )
    );
    return {
      completedCount: completed.length,
      squareFeet,
      roofingSquares: roundMeasurement(squareFeet / 100),
    };
  }, [measurements]);

  const readiness = useMemo(
    () => [
      { label: "Customer selected", ready: Boolean(form.customerName.trim()) },
      { label: "Project connected", ready: Boolean(selectedJob) },
      {
        label: "Job materials synced",
        ready: materialSyncReady && syncedMaterialLines.length > 0,
      },
      {
        label: "Delivery email ready",
        ready: Boolean(form.customerEmail.trim()),
      },
    ],
    [
      form.customerEmail,
      form.customerName,
      materialSyncReady,
      selectedJob,
      syncedMaterialLines.length,
    ]
  );

  function updateForm<Key extends keyof FormState>(
    key: Key,
    value: FormState[Key]
  ) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function changeJob(nextJobId: string) {
    setSelectedJobId(nextJobId);
    const job = jobs.find((item) => item.id === nextJobId);
    if (!job) return;
    setForm((current) => ({
      ...current,
      customerName: job.customer?.name || "",
      customerEmail: job.customer?.email || "",
      customerPhone: job.customer?.phone || "",
      projectTitle: projectTypeLabel(job.projectType),
    }));
  }

  function updateMeasurement(
    measurementId: string,
    key: "length" | "width",
    value: string
  ) {
    setMeasurements((current) =>
      current.map((measurement) =>
        measurement.id === measurementId
          ? { ...measurement, [key]: value }
          : measurement
      )
    );
    setMeasurementsFinalized(false);
  }

  function removeMeasurement(measurementId: string) {
    setMeasurements((current) => {
      const remaining = current.filter(
        (measurement) => measurement.id !== measurementId
      );
      return remaining.length > 0 ? remaining : [newMeasurement()];
    });
    setMeasurementsFinalized(false);
  }

  function finishMeasurements() {
    const hasIncompleteMeasurement = measurements.some((measurement) => {
      const hasLength = positiveNumber(measurement.length) > 0;
      const hasWidth = positiveNumber(measurement.width) > 0;
      return hasLength !== hasWidth;
    });
    if (hasIncompleteMeasurement) {
      setError(
        "Complete both dimensions for every roof area, or remove the incomplete row."
      );
      setSuccess(null);
      return;
    }
    if (measurementTotals.completedCount === 0) {
      setError(
        "Add at least one complete roof dimension before marking pricing done."
      );
      setSuccess(null);
      return;
    }
    setError(null);
    setMeasurementsFinalized(true);
    setSuccess(
      "Pricing measurements complete: " +
        formatMeasurement(measurementTotals.squareFeet) +
        " sq. ft."
    );
  }

  async function generateNumber() {
    if (!orgId) return `EST-${new Date().getFullYear()}-0001`;
    const year = new Date().getFullYear();
    const prefix = `EST-${year}-`;
    const snapshot = await getDocs(
      query(
        collection(db, "estimates"),
        where("organizationId", "==", orgId)
      )
    );
    const max = snapshot.docs.reduce((highest, snapshotDocument) => {
      const number = String(snapshotDocument.data().number || "");
      if (!number.startsWith(prefix)) return highest;
      const sequence = Number(number.slice(prefix.length));
      return Number.isFinite(sequence) ? Math.max(highest, sequence) : highest;
    }, 0);
    return `${prefix}${String(max + 1).padStart(4, "0")}`;
  }

  async function persist(mode: SaveMode) {
    setError(null);
    setSuccess(null);

    if (!orgId) {
      setError("Your organization is still loading. Please try again.");
      return;
    }
    if (!selectedJob) {
      setError("Choose the job this estimate belongs to.");
      return;
    }
    if (!form.customerName.trim()) {
      setError("Add the customer name before saving the estimate.");
      return;
    }
    if (!materialSyncReady) {
      setError("Job materials are still syncing. Please try again in a moment.");
      return;
    }
    const completedLines = lines.filter((line) => line.title.trim());
    if (completedLines.length === 0) {
      setError(
        "Add at least one material to this job before creating its estimate."
      );
      return;
    }
    const hasIncompleteMeasurement = measurements.some((measurement) => {
      const hasLength = positiveNumber(measurement.length) > 0;
      const hasWidth = positiveNumber(measurement.width) > 0;
      return hasLength !== hasWidth;
    });
    if (hasIncompleteMeasurement) {
      setError(
        "Complete both dimensions for every roof area, or remove the incomplete row."
      );
      return;
    }
    if (mode === "send" && !/^\S+@\S+\.\S+$/.test(form.customerEmail)) {
      setError("Add a valid customer email before sending.");
      return;
    }
    if (
      existing?.status === "accepted" ||
      existing?.status === "converted_to_contract"
    ) {
      setError("Accepted estimates are locked. Create a revision instead.");
      return;
    }

    const previewWindow =
      mode === "preview" ? window.open("about:blank", "_blank") : null;
    setSavingMode(mode);
    try {
      const estimateRef = existing
        ? doc(db, "estimates", existing.id)
        : doc(collection(db, "estimates"));
      const number = existing?.number || (await generateNumber());
      const lineItems: EstimateLineItem[] = completedLines;
      const roofMeasurements: RoofMeasurement[] = measurements
        .filter(
          (measurement) =>
            positiveNumber(measurement.length) > 0 &&
            positiveNumber(measurement.width) > 0
        )
        .map((measurement) => {
          const lengthFt = roundMeasurement(
            positiveNumber(measurement.length)
          );
          const widthFt = roundMeasurement(positiveNumber(measurement.width));
          const areaSquareFeet = roundMeasurement(lengthFt * widthFt);
          return {
            id: measurement.id,
            lengthFt,
            widthFt,
            areaSquareFeet,
            roofingSquares: roundMeasurement(areaSquareFeet / 100),
          };
        });
      const nextStatus: EstimateStatus =
        mode === "send"
          ? "ready_to_send"
          : existing?.status === "sent" || existing?.status === "viewed"
            ? "revising"
            : "draft";
      const estimate: EstimateRecord = {
        id: estimateRef.id,
        organizationId: orgId,
        orgId,
        jobId: selectedJob.id,
        ...(selectedJob.customer?.id
          ? { customerId: selectedJob.customer.id }
          : {}),
        number,
        version: existing?.version || 1,
        status: nextStatus,
        documentType: "estimate",
        projectTitle: form.projectTitle.trim(),
        issueDate: form.issueDate || null,
        validUntil: form.validUntil || null,
        customerSnapshot: {
          name: form.customerName.trim(),
          ...(form.customerEmail.trim()
            ? { email: form.customerEmail.trim() }
            : {}),
          ...(form.customerPhone.trim()
            ? { phone: form.customerPhone.trim() }
            : {}),
        },
        propertyAddressSnapshot: addressSnapshot(selectedJob),
        organizationSnapshot: organization,
        roofMeasurements,
        roofAreaSquareFeet: measurementTotals.squareFeet,
        roofSquares: measurementTotals.roofingSquares,
        measurementsFinalized:
          measurementsFinalized && roofMeasurements.length > 0,
        lineItems,
        subtotalCents: totals.subtotalCents,
        discountCents: totals.discountCents,
        taxCents: totals.taxCents,
        taxRatePercent: Math.max(0, Number(form.taxRate) || 0),
        totalCents: totals.totalCents,
        depositCents: totals.depositCents,
        paymentTerms: form.paymentTerms.trim(),
        warrantyText: form.warrantyText.trim(),
        notes: form.notes.trim(),
        assumptions: splitLines(form.assumptions),
        exclusions: splitLines(form.exclusions),
        ...(existing?.createdAt
          ? { createdAt: existing.createdAt }
          : { createdAt: serverTimestamp() }),
        updatedAt: serverTimestamp(),
      };

      await setDoc(estimateRef, estimate, { merge: true });
      setExisting(estimate);

      if (!id) {
        navigate(`/estimates/${estimateRef.id}/edit`, { replace: true });
      }

      if (mode === "send") {
        const sendEstimate = httpsCallable<
          { estimateId: string; email: string },
          { ok: boolean; publicUrl?: string }
        >(functions, "sendEstimateEmail");
        await sendEstimate({
          estimateId: estimateRef.id,
          email: form.customerEmail.trim(),
        });
        setExisting({ ...estimate, status: "sent" });
        setSuccess(`Estimate ${number} was emailed to ${form.customerEmail}.`);
      } else if (mode === "preview") {
        if (previewWindow) {
          previewWindow.opener = null;
          previewWindow.location.href = `/estimate/${estimateRef.id}`;
        } else {
          window.open(`/estimate/${estimateRef.id}`, "_blank", "noopener");
        }
        setSuccess("Draft saved and print preview opened.");
      } else {
        setSuccess(`Estimate ${number} saved as a draft.`);
      }
    } catch (caught) {
      previewWindow?.close();
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSavingMode(null);
    }
  }

  if (loading) {
    return (
      <div className="admin-loading">
        <Loader2 className="estimate-spin" size={18} /> Loading estimate…
      </div>
    );
  }

  return (
    <main className="admin-page estimate-builder-page">
      <div className="admin-content-width estimate-builder-shell">
        <header className="estimate-builder-header">
          <div>
            <Link
              to={
                selectedJob
                  ? `/job/${selectedJob.id}?tab=financials`
                  : "/invoices-page"
              }
            >
              <ArrowLeft size={14} /> Back to documents
            </Link>
            <span className="admin-kicker">Estimate studio</span>
            <h1>{existing ? `Edit ${existing.number}` : "Create an estimate"}</h1>
            <p>
              Build a clear, itemized proposal that is ready to email, print,
              or download as a professional PDF.
            </p>
          </div>
          <div className="estimate-builder-status">
            <span className={`admin-status status-${existing?.status || "draft"}`}>
              {existing?.status?.replaceAll("_", " ") || "New draft"}
            </span>
            {existing && <small>Version {existing.version}</small>}
          </div>
        </header>

        {(error || success) && (
          <div
            className={
              error ? "estimate-notice is-error" : "estimate-notice is-success"
            }
            role="status"
          >
            {error ? "!" : <Check size={16} />}
            <span>{error || success}</span>
          </div>
        )}

        <div className="estimate-builder-layout">
          <div className="estimate-builder-main">
            <section className="admin-card estimate-form-section">
              <div className="estimate-section-heading">
                <span>01</span>
                <div>
                  <h2>Customer and project</h2>
                  <p>Connect the estimate to a job and confirm who receives it.</p>
                </div>
              </div>
              <div className="estimate-form-grid">
                <label className="estimate-field estimate-field-wide">
                  <span>Job / property</span>
                  <select
                    value={selectedJobId}
                    onChange={(event) => changeJob(event.target.value)}
                  >
                    {jobs.length === 0 && <option value="">No jobs available</option>}
                    {jobs.map((job) => (
                      <option value={job.id} key={job.id}>
                        {jobAddress(job)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="estimate-field">
                  <span>Customer name</span>
                  <input
                    value={form.customerName}
                    onChange={(event) =>
                      updateForm("customerName", event.target.value)
                    }
                    placeholder="Customer or company name"
                  />
                </label>
                <label className="estimate-field">
                  <span>Customer email</span>
                  <input
                    type="email"
                    value={form.customerEmail}
                    onChange={(event) =>
                      updateForm("customerEmail", event.target.value)
                    }
                    placeholder="customer@example.com"
                  />
                </label>
                <label className="estimate-field">
                  <span>Customer phone</span>
                  <input
                    value={form.customerPhone}
                    onChange={(event) =>
                      updateForm("customerPhone", event.target.value)
                    }
                    placeholder="(210) 555-0123"
                  />
                </label>
                <label className="estimate-field">
                  <span>Project title</span>
                  <input
                    value={form.projectTitle}
                    onChange={(event) =>
                      updateForm("projectTitle", event.target.value)
                    }
                  />
                </label>
                <label className="estimate-field">
                  <span>Estimate date</span>
                  <input
                    type="date"
                    value={form.issueDate}
                    onChange={(event) =>
                      updateForm("issueDate", event.target.value)
                    }
                  />
                </label>
                <label className="estimate-field">
                  <span>Valid through</span>
                  <input
                    type="date"
                    value={form.validUntil}
                    onChange={(event) =>
                      updateForm("validUntil", event.target.value)
                    }
                  />
                </label>
              </div>
            </section>

            <section
              className={
                "admin-card estimate-form-section estimate-measurement-section" +
                (measurementsFinalized ? " is-complete" : "")
              }
            >
              <div className="estimate-section-heading">
                <span>02</span>
                <div>
                  <h2>Pricing</h2>
                  <p>
                    Enter each roof area in feet. Square footage and roofing SQ
                    are calculated automatically.
                  </p>
                </div>
              </div>

              <div className="estimate-measurement-workspace">
                <div className="estimate-measurement-intro">
                  <div>
                    <i aria-hidden="true">
                      <Ruler size={19} />
                    </i>
                    <div>
                      <strong>Roof dimensions</strong>
                      <p>
                        Break the roof into rectangular areas and enter only the
                        two measured sides.
                      </p>
                    </div>
                  </div>
                  <div className="estimate-measurement-formula">
                    <span>Roofing reference</span>
                    <strong>100 sq. ft. = 1 SQ</strong>
                    <small>Admin only</small>
                  </div>
                </div>

                <div className="estimate-measurement-list">
                  {measurements.map((measurement, index) => {
                    const areaSquareFeet = measurementArea(measurement);
                    const roofingSquares = roundMeasurement(
                      areaSquareFeet / 100
                    );
                    return (
                      <article key={measurement.id}>
                        <div className="estimate-measurement-index">
                          <span>Area</span>
                          <strong>{String(index + 1).padStart(2, "0")}</strong>
                        </div>
                        <label>
                          <span>Length</span>
                          <div>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              inputMode="decimal"
                              value={measurement.length}
                              onChange={(event) =>
                                updateMeasurement(
                                  measurement.id,
                                  "length",
                                  event.target.value
                                )
                              }
                              placeholder="12"
                              aria-label={
                                "Area " + (index + 1) + " length in feet"
                              }
                            />
                            <span>ft</span>
                          </div>
                        </label>
                        <b aria-hidden="true">×</b>
                        <label>
                          <span>Width</span>
                          <div>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              inputMode="decimal"
                              value={measurement.width}
                              onChange={(event) =>
                                updateMeasurement(
                                  measurement.id,
                                  "width",
                                  event.target.value
                                )
                              }
                              placeholder="8"
                              aria-label={
                                "Area " + (index + 1) + " width in feet"
                              }
                            />
                            <span>ft</span>
                          </div>
                        </label>
                        <div className="estimate-measurement-result">
                          <span>Square footage</span>
                          <strong>
                            {areaSquareFeet > 0
                              ? formatMeasurement(areaSquareFeet) + " sq. ft."
                              : "—"}
                          </strong>
                        </div>
                        <div className="estimate-measurement-result is-admin">
                          <span>
                            Roofing SQ <small>Admin only</small>
                          </span>
                          <strong>
                            {areaSquareFeet > 0
                              ? formatMeasurement(roofingSquares) + " SQ"
                              : "—"}
                          </strong>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeMeasurement(measurement.id)}
                          aria-label={"Remove area " + (index + 1)}
                        >
                          <Trash2 size={15} />
                        </button>
                      </article>
                    );
                  })}
                </div>

                <div className="estimate-measurement-footer">
                  <button
                    className="estimate-add-measurement"
                    type="button"
                    onClick={() => {
                      setMeasurements((current) => [
                        ...current,
                        newMeasurement(),
                      ]);
                      setMeasurementsFinalized(false);
                    }}
                  >
                    <Plus size={15} /> Add another area
                  </button>
                  <div className="estimate-measurement-total">
                    <div>
                      <span>Total roof area</span>
                      <strong>
                        {formatMeasurement(measurementTotals.squareFeet)} sq. ft.
                      </strong>
                    </div>
                    <div>
                      <span>
                        Total roofing SQ <small>Admin only</small>
                      </span>
                      <strong>
                        {formatMeasurement(measurementTotals.roofingSquares)} SQ
                      </strong>
                    </div>
                    <button
                      type="button"
                      onClick={finishMeasurements}
                      disabled={measurementTotals.completedCount === 0}
                    >
                      {measurementsFinalized ? (
                        <Check size={15} />
                      ) : (
                        <Calculator size={15} />
                      )}
                      {measurementsFinalized ? "Measurements complete" : "Done"}
                    </button>
                  </div>
                </div>
              </div>
            </section>

            <section className="admin-card estimate-form-section estimate-line-section">
              <div className="estimate-section-heading estimate-section-heading-actions">
                <span>03</span>
                <div>
                  <h2>Job materials</h2>
                  <p>
                    Synced automatically from this job. Roofing SQ is converted
                    to customer-friendly square footage on the estimate.
                  </p>
                </div>
                {selectedJob && (
                  <Link
                    className="estimate-manage-materials"
                    to={`/job/${selectedJob.id}?tab=materials`}
                  >
                    Manage job materials <ArrowRight size={14} />
                  </Link>
                )}
              </div>

              {!materialSyncReady ? (
                <div className="estimate-material-sync-state">
                  <Loader2 className="estimate-spin" size={20} />
                  <div>
                    <strong>Syncing job materials…</strong>
                    <span>Preparing the customer-facing material schedule.</span>
                  </div>
                </div>
              ) : lines.length === 0 ? (
                <div className="estimate-material-sync-state is-empty">
                  <FileText size={23} />
                  <div>
                    <strong>No materials have been added to this job.</strong>
                    <span>
                      Add material expenses in the job workspace, then they will
                      appear here automatically.
                    </span>
                  </div>
                  {selectedJob && (
                    <Link to={`/job/${selectedJob.id}?tab=materials`}>
                      Add job materials <ArrowRight size={14} />
                    </Link>
                  )}
                </div>
              ) : (
                <>
                  <div className="estimate-material-sync-note">
                    <Check size={15} />
                    <span>
                      {usingSavedSnapshot
                        ? "Showing this estimate’s saved material snapshot because the job has no current material records."
                        : `${jobMaterials.length} job material${jobMaterials.length === 1 ? "" : "s"} synced. Changes are made from the job’s Materials tab.`}
                    </span>
                  </div>
                  <div className="estimate-editor-table-wrap">
                    <table className="estimate-editor-table estimate-synced-materials-table">
                      <thead>
                        <tr>
                          <th>Material</th>
                          <th>Quantity</th>
                          <th>Unit</th>
                          <th>Rate / unit</th>
                          <th>Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {lines.map((line) => (
                          <tr key={line.id}>
                            <td>
                              <div className="estimate-synced-material">
                                <span><Check size={13} /></span>
                                <div>
                                  <strong>{line.title}</strong>
                                  {line.customerDescription && (
                                    <small>{line.customerDescription}</small>
                                  )}
                                </div>
                              </div>
                            </td>
                            <td data-label="Quantity">
                              {formatMeasurement(line.quantity)}
                            </td>
                            <td data-label="Unit">{unitLabels[line.unit]}</td>
                            <td data-label="Rate / unit">
                              {money(line.unitPriceCents)}
                            </td>
                            <td data-label="Amount">
                              <strong>{money(line.lineTotalCents)}</strong>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </section>

            <section className="admin-card estimate-form-section">
              <div className="estimate-section-heading">
                <span>04</span>
                <div>
                  <h2>Terms and totals</h2>
                  <p>Add the commercial details that make the estimate complete.</p>
                </div>
              </div>
              <div className="estimate-form-grid estimate-total-inputs">
                <label className="estimate-field">
                  <span>Discount</span>
                  <div className="estimate-money-input">
                    <span>$</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.discount}
                      onChange={(event) =>
                        updateForm("discount", event.target.value)
                      }
                    />
                  </div>
                </label>
                <label className="estimate-field">
                  <span>Sales tax</span>
                  <div className="estimate-suffix-input">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.taxRate}
                      onChange={(event) =>
                        updateForm("taxRate", event.target.value)
                      }
                    />
                    <span>%</span>
                  </div>
                </label>
                <label className="estimate-field">
                  <span>Requested deposit</span>
                  <div className="estimate-money-input">
                    <span>$</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.deposit}
                      onChange={(event) =>
                        updateForm("deposit", event.target.value)
                      }
                    />
                  </div>
                </label>
                <label className="estimate-field estimate-field-wide">
                  <span>Payment terms</span>
                  <textarea
                    rows={2}
                    value={form.paymentTerms}
                    onChange={(event) =>
                      updateForm("paymentTerms", event.target.value)
                    }
                  />
                </label>
                <label className="estimate-field estimate-field-wide">
                  <span>Workmanship warranty</span>
                  <textarea
                    rows={3}
                    value={form.warrantyText}
                    onChange={(event) =>
                      updateForm("warrantyText", event.target.value)
                    }
                  />
                </label>
                <label className="estimate-field estimate-field-wide">
                  <span>Project notes</span>
                  <textarea
                    rows={3}
                    value={form.notes}
                    onChange={(event) => updateForm("notes", event.target.value)}
                  />
                </label>
                <label className="estimate-field">
                  <span>Assumptions · one per line</span>
                  <textarea
                    rows={4}
                    value={form.assumptions}
                    onChange={(event) =>
                      updateForm("assumptions", event.target.value)
                    }
                  />
                </label>
                <label className="estimate-field">
                  <span>Not included · one per line</span>
                  <textarea
                    rows={4}
                    value={form.exclusions}
                    onChange={(event) =>
                      updateForm("exclusions", event.target.value)
                    }
                  />
                </label>
              </div>
            </section>
          </div>

          <aside className="estimate-builder-aside">
            <section className="admin-card estimate-summary-card">
              <div className="estimate-summary-heading">
                <span>Estimate summary</span>
                <FileText size={18} />
              </div>
              <strong>{money(totals.totalCents)}</strong>
              <small>{lines.filter((line) => line.title.trim()).length} line items</small>
              <dl>
                {measurementTotals.squareFeet > 0 && (
                  <>
                    <div>
                      <dt>Roof area</dt>
                      <dd>
                        {formatMeasurement(measurementTotals.squareFeet)} sq. ft.
                      </dd>
                    </div>
                    <div>
                      <dt>Roofing SQ · admin</dt>
                      <dd>
                        {formatMeasurement(measurementTotals.roofingSquares)} SQ
                      </dd>
                    </div>
                  </>
                )}
                <div>
                  <dt>Subtotal</dt>
                  <dd>{money(totals.subtotalCents)}</dd>
                </div>
                {totals.discountCents > 0 && (
                  <div>
                    <dt>Discount</dt>
                    <dd>−{money(totals.discountCents)}</dd>
                  </div>
                )}
                {totals.taxCents > 0 && (
                  <div>
                    <dt>Tax</dt>
                    <dd>{money(totals.taxCents)}</dd>
                  </div>
                )}
                {totals.depositCents > 0 && (
                  <div>
                    <dt>Deposit</dt>
                    <dd>{money(totals.depositCents)}</dd>
                  </div>
                )}
              </dl>
              <button
                type="button"
                className="admin-secondary-button"
                disabled={Boolean(savingMode)}
                onClick={() => void persist("preview")}
              >
                <Eye size={15} /> Preview & print
              </button>
            </section>

            <section className="admin-card estimate-readiness-card">
              <span>Ready to send?</span>
              <div>
                {readiness.map((item) => (
                  <p className={item.ready ? "is-ready" : ""} key={item.label}>
                    <i>{item.ready ? <Check size={12} /> : ""}</i>
                    {item.label}
                  </p>
                ))}
              </div>
              <small>
                Sending creates a private customer link. The estimate remains
                connected to this job for future revisions.
              </small>
            </section>
          </aside>
        </div>

        <div className="estimate-builder-actions">
          <div>
            <Mail size={15} />
            <span>
              {form.customerEmail || "Add a customer email to enable delivery"}
            </span>
          </div>
          <div>
            <button
              type="button"
              className="admin-secondary-button"
              disabled={Boolean(savingMode)}
              onClick={() => void persist("draft")}
            >
              {savingMode === "draft" ? (
                <Loader2 className="estimate-spin" size={15} />
              ) : (
                <Save size={15} />
              )}
              Save draft
            </button>
            <button
              type="button"
              className="admin-primary-button"
              disabled={Boolean(savingMode)}
              onClick={() => void persist("send")}
            >
              {savingMode === "send" ? (
                <Loader2 className="estimate-spin" size={15} />
              ) : (
                <Send size={15} />
              )}
              Save & send
              {!savingMode && <ArrowRight size={14} />}
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
