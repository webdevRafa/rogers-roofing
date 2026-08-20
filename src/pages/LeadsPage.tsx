import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  CalendarPlus,
  Loader2,
  Mail,
  MapPin,
  MessageSquareText,
  Phone,
  RefreshCw,
  Search,
  UserRoundSearch,
} from "lucide-react";
import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";

import { useOrg } from "../contexts/OrgContext";
import { db } from "../firebase/firebaseConfig";
import {
  LEAD_STATUS_LABELS,
  type CustomerLead,
  type EstimateRecord,
  type LeadStatus,
  type ProjectType,
  type RoofingService,
} from "../domain/roofing";
import type { FieldValue } from "firebase/firestore";
import type { Job } from "../types/types";
import { jobConverter } from "../types/types";
import { recomputeJob } from "../utils/calc";

type FsDate = { toDate?: () => Date; seconds?: number };

const INTAKE_STATUS_OPTIONS: LeadStatus[] = [
  "new",
  "contacted",
  "inspection_scheduled",
  "lost",
  "archived",
];

const OPEN_REQUEST_STATUSES: LeadStatus[] = [
  "new",
  "contacted",
  "inspection_scheduled",
];

const DEFAULT_PAYMENT_TERMS =
  "Payment schedule will be confirmed with the customer before work begins.";
const DEFAULT_WARRANTY =
  "One-year workmanship warranty covering leaks, blown shingles, and installation-related seal failure. Manufacturer warranties remain subject to their published terms.";
const DEFAULT_NOTES =
  "Final quantities may be adjusted if concealed decking damage or other unforeseen conditions are discovered after tear-off.";

function toDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  const timestamp = value as FsDate;
  if (typeof timestamp.toDate === "function") return timestamp.toDate();
  if (typeof timestamp.seconds === "number") {
    return new Date(timestamp.seconds * 1000);
  }
  return null;
}

function formatDate(value: unknown): string {
  const date = toDate(value);
  if (!date) return "Recently";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function serviceLabel(service: RoofingService): string {
  return {
    roof_replacement: "Roof replacement",
    roof_repair: "Roof repair",
    storm_damage: "Storm damage",
    new_construction: "New construction",
    inspection: "Roof inspection",
    commercial_roofing: "Commercial roofing",
    gutters: "Gutters / drainage",
    other: "Other service",
  }[service];
}

function projectTypeFromService(service: RoofingService): ProjectType {
  if (service === "roof_repair") return "repair";
  if (service === "storm_damage") return "storm_restoration";
  if (service === "new_construction") return "new_install";
  if (service === "commercial_roofing") return "commercial";
  return "replacement";
}

function estimateProjectTitle(service: RoofingService) {
  return `${serviceLabel(service)} estimate`;
}

function dateInput(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export default function LeadsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { orgId, orgName, loading: orgLoading } = useOrg();
  const [leads, setLeads] = useState<CustomerLead[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<LeadStatus | "open">("open");
  const [selected, setSelected] = useState<CustomerLead | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  async function generateEstimateNumber() {
    if (!orgId) throw new Error("Your organization is still loading.");
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

  async function pendingEstimateForLead(
    lead: CustomerLead,
    jobId: string
  ) {
    if (!orgId) throw new Error("Your organization is still loading.");
    const estimateRef = doc(collection(db, "estimates"));
    const issueDate = new Date();
    const validUntil = new Date(issueDate);
    validUntil.setDate(validUntil.getDate() + 30);
    const estimate: EstimateRecord = {
      id: estimateRef.id,
      organizationId: orgId,
      orgId,
      jobId,
      sourceLeadId: lead.id,
      number: await generateEstimateNumber(),
      version: 1,
      status: "lead_received",
      documentType: "estimate",
      projectTitle: estimateProjectTitle(lead.service),
      issueDate: dateInput(issueDate),
      validUntil: dateInput(validUntil),
      customerSnapshot: {
        name: `${lead.firstName} ${lead.lastName}`.trim(),
        email: lead.email,
        phone: lead.phone,
      },
      propertyAddressSnapshot: lead.propertyAddress,
      organizationSnapshot: {
        name: orgName || "Roger's Roofing",
      },
      roofMeasurements: [],
      roofAreaSquareFeet: 0,
      roofSquares: 0,
      measurementsFinalized: false,
      lineItems: [],
      subtotalCents: 0,
      discountCents: 0,
      taxCents: 0,
      taxRatePercent: 0,
      totalCents: 0,
      depositCents: 0,
      paymentTerms: DEFAULT_PAYMENT_TERMS,
      warrantyText: DEFAULT_WARRANTY,
      notes: DEFAULT_NOTES,
      assumptions: ["Property access will be available during scheduled work."],
      exclusions: [
        "Structural repairs, permits, and concealed damage are excluded unless specifically listed above.",
      ],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    return { estimateRef, estimate };
  }

  async function findEstimateForJob(jobId: string) {
    if (!orgId) return null;
    const snapshot = await getDocs(
      query(collection(db, "estimates"), where("jobId", "==", jobId))
    );
    const estimates = snapshot.docs
      .map((estimateDocument) => ({
        id: estimateDocument.id,
        ...(estimateDocument.data() as Omit<EstimateRecord, "id">),
      }))
      .filter(
        (estimate) =>
          estimate.organizationId === orgId || estimate.orgId === orgId
      );
    return (
      [...estimates].sort(
        (a, b) =>
          (toDate(b.updatedAt)?.getTime() ??
            toDate(b.createdAt)?.getTime() ??
            0) -
          (toDate(a.updatedAt)?.getTime() ??
            toDate(a.createdAt)?.getTime() ??
            0)
      )[0] || null
    );
  }

  async function findJobForLead(lead: CustomerLead) {
    if (lead.linkedJobId) return lead.linkedJobId;
    if (!orgId) return null;
    const snapshot = await getDocs(
      query(collection(db, "jobs"), where("sourceLeadId", "==", lead.id))
    );
    const existingJob = snapshot.docs.find((jobDocument) => {
      const job = jobDocument.data() as Partial<Job>;
      return job.orgId === orgId;
    });
    return existingJob?.id || null;
  }

  async function createJobFromLead(lead: CustomerLead) {
    if (!orgId) throw new Error("Your organization is still loading.");
    const jobRef = doc(collection(db, "jobs"));
    const { estimateRef, estimate } = await pendingEstimateForLead(
      lead,
      jobRef.id
    );
    const baseJob: Job = {
      id: jobRef.id,
      orgId,
      status: "pending",
      address: lead.propertyAddress,
      customer: {
        name: `${lead.firstName} ${lead.lastName}`.trim(),
        email: lead.email,
        phone: lead.phone,
      },
      projectType: projectTypeFromService(lead.service),
      sourceLeadId: lead.id,
      priority: lead.urgency === "emergency" ? "urgent" : "normal",
      earnings: {
        totalEarningsCents: 0,
        entries: [],
        currency: "USD",
      },
      expenses: {
        totalPayoutsCents: 0,
        totalMaterialsCents: 0,
        payouts: [],
        materials: [],
        currency: "USD",
      },
      summaryNotes: lead.message || "",
      attachments: [],
      createdAt: serverTimestamp() as unknown as FieldValue,
      updatedAt: serverTimestamp() as unknown as FieldValue,
      computed: {
        totalExpensesCents: 0,
        netProfitCents: 0,
      },
    };
    const job = recomputeJob(baseJob);
    const batch = writeBatch(db);
    batch.set(jobRef.withConverter(jobConverter), job);
    batch.set(estimateRef, estimate);
    batch.update(doc(db, "leads", lead.id), {
      status: "won",
      linkedJobId: jobRef.id,
      linkedEstimateId: estimateRef.id,
      convertedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
    setSelected(null);
    return { jobId: jobRef.id, estimateId: estimateRef.id };
  }

  useEffect(() => {
    if (!orgId) {
      setLeads([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    const leadsQuery = query(
      collection(db, "leads"),
      where("orgId", "==", orgId)
    );

    return onSnapshot(
      leadsQuery,
      (snapshot) => {
        const nextLeads = snapshot.docs.map((document) => ({
          id: document.id,
          ...(document.data() as Omit<CustomerLead, "id">),
        }));
        setLeads(nextLeads);
        setSelected((current) => {
          if (!current) return null;
          const liveRequest = nextLeads.find((lead) => lead.id === current.id);
          return liveRequest && !liveRequest.linkedJobId ? liveRequest : null;
        });
        setLoading(false);
      },
      (snapshotError) => {
        setError(snapshotError.message);
        setLoading(false);
      }
    );
  }, [orgId, retryKey]);

  const requestedLeadId = searchParams.get("request");

  useEffect(() => {
    if (!requestedLeadId) return;
    const requestedLead = leads.find(
      (lead) => lead.id === requestedLeadId && !lead.linkedJobId
    );
    if (requestedLead) setSelected(requestedLead);
  }, [leads, requestedLeadId]);

  function openRequest(lead: CustomerLead) {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("request", lead.id);
    setSearchParams(nextParams, { replace: true });
    setSelected(lead);
  }

  function closeRequest() {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("request");
    setSearchParams(nextParams, { replace: true });
    setSelected(null);
  }

  const intakeLeads = useMemo(
    () => leads.filter((lead) => !lead.linkedJobId),
    [leads]
  );

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return [...intakeLeads]
      .filter((lead) =>
        status === "open"
          ? OPEN_REQUEST_STATUSES.includes(lead.status)
          : lead.status === status
      )
      .filter((lead) => {
        if (!term) return true;
        return [
          lead.firstName,
          lead.lastName,
          lead.email,
          lead.phone,
          lead.propertyAddress?.fullLine,
          serviceLabel(lead.service),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(term);
      })
      .sort(
        (a, b) =>
          (toDate(b.createdAt)?.getTime() ?? 0) -
          (toDate(a.createdAt)?.getTime() ?? 0)
      );
  }, [intakeLeads, search, status]);

  async function changeStatus(lead: CustomerLead, nextStatus: LeadStatus) {
    setSavingId(lead.id);
    setError(null);
    try {
      await updateDoc(doc(db, "leads", lead.id), {
        status: nextStatus,
        updatedAt: serverTimestamp(),
        ...(nextStatus === "contacted"
          ? { lastContactedAt: serverTimestamp() }
          : {}),
      });
      setSelected((current) =>
        current?.id === lead.id ? { ...current, status: nextStatus } : current
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSavingId(null);
    }
  }

  async function convertToJob(lead: CustomerLead) {
    if (!orgId) return;
    setSavingId(lead.id);
    setError(null);

    try {
      const existingJobId = await findJobForLead(lead);
      let jobId: string;
      if (existingJobId) {
        jobId = existingJobId;
        const existingEstimate = await findEstimateForJob(jobId);
        const batch = writeBatch(db);
        let estimateId = existingEstimate?.id || "";
        if (!existingEstimate) {
          const { estimateRef, estimate } = await pendingEstimateForLead(
            lead,
            jobId
          );
          batch.set(estimateRef, estimate);
          estimateId = estimateRef.id;
        }
        batch.update(doc(db, "leads", lead.id), {
          status: "won",
          linkedJobId: jobId,
          linkedEstimateId: estimateId,
          convertedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        await batch.commit();
      } else {
        ({ jobId } = await createJobFromLead(lead));
      }
      navigate(`/job/${jobId}?tab=financials`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setSavingId(null);
    }
  }

  if (loading || orgLoading) {
    return (
      <div className="admin-loading">
        <div>
          <span />
          Loading estimate requests…
        </div>
      </div>
    );
  }

  return (
    <main className="admin-page leads-page">
      <div className="admin-content-width">
        <header className="admin-page-header">
          <div>
            <span className="admin-kicker">Estimate request pipeline</span>
            <h1>Estimate requests</h1>
            <p>
              This is the intake queue for new website requests. Converting a
              request creates its job and first estimate, then moves the work
              into the job workspace.
            </p>
          </div>
          <div className="leads-summary">
            <span>
              {intakeLeads.filter((lead) => lead.status === "new").length}
            </span>
            new requests
          </div>
        </header>

        <section className="admin-card leads-workspace">
          <div className="admin-toolbar">
            <label className="admin-search-field">
              <Search size={16} />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search name, address, email, or service"
              />
            </label>
            <select
              className="admin-filter-select"
              value={status}
              onChange={(event) =>
                setStatus(event.target.value as LeadStatus | "open")
              }
            >
              <option value="open">Open requests</option>
              {INTAKE_STATUS_OPTIONS.map((value) => (
                <option value={value} key={value}>
                  {LEAD_STATUS_LABELS[value]}
                </option>
              ))}
            </select>
            <span className="admin-toolbar-count">
              {filtered.length}{" "}
              {filtered.length === 1 ? "request" : "requests"}
            </span>
          </div>

          {error ? (
            <div className="admin-empty leads-load-error" role="alert">
              <div>
                <AlertTriangle size={34} />
                <strong>We couldn&apos;t load the request inbox</strong>
                <p>
                  Your requests are still safely stored. Check your connection
                  or workspace access, then try again.
                </p>
                <button
                  className="admin-secondary-button"
                  type="button"
                  onClick={() => setRetryKey((current) => current + 1)}
                >
                  <RefreshCw size={15} />
                  Try again
                </button>
                <small>{error}</small>
              </div>
            </div>
          ) : filtered.length === 0 ? (
            <div className="admin-empty">
              <div>
                <UserRoundSearch size={34} />
                <strong>
                  {search || status !== "open"
                    ? "No requests match these filters"
                    : "Your request inbox is clear"}
                </strong>
                {search || status !== "open" ? (
                  <>
                    <p>
                      Try another search or clear the filters to see the full
                      request queue.
                    </p>
                    <button
                      className="admin-secondary-button"
                      type="button"
                      onClick={() => {
                        setSearch("");
                        setStatus("open");
                      }}
                    >
                      Clear filters
                    </button>
                  </>
                ) : (
                  <p>
                    New website requests will appear here. Converted requests
                    continue in their job workspace and document history.
                  </p>
                )}
              </div>
            </div>
          ) : (
            <div className="leads-table-wrap">
              <table className="admin-table leads-table">
                <thead>
                  <tr>
                    <th>Customer</th>
                    <th>Property</th>
                    <th>Service</th>
                    <th>Received</th>
                    <th>Status</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((lead) => (
                    <tr key={lead.id}>
                      <td>
                        <button
                          className="admin-table-primary"
                          type="button"
                          onClick={() => openRequest(lead)}
                        >
                          <span>
                            {lead.firstName.charAt(0)}
                            {lead.lastName.charAt(0)}
                          </span>
                          <div>
                            <strong>
                              {lead.firstName} {lead.lastName}
                            </strong>
                            <small>{lead.email}</small>
                          </div>
                        </button>
                      </td>
                      <td>
                        <div className="admin-table-stack">
                          <strong>{lead.propertyAddress?.fullLine}</strong>
                          <small>{lead.phone}</small>
                        </div>
                      </td>
                      <td>
                        <div className="admin-table-stack">
                          <strong>{serviceLabel(lead.service)}</strong>
                          <small>{lead.urgency.replaceAll("_", " ")}</small>
                        </div>
                      </td>
                      <td>{formatDate(lead.createdAt)}</td>
                      <td>
                        <select
                          className={`admin-status status-${lead.status}`}
                          value={lead.status}
                          disabled={savingId === lead.id}
                          onChange={(event) =>
                            changeStatus(lead, event.target.value as LeadStatus)
                          }
                        >
                          {INTAKE_STATUS_OPTIONS.map((value) => (
                            <option value={value} key={value}>
                              {LEAD_STATUS_LABELS[value]}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <div className="leads-row-actions">
                          <button
                            className="admin-row-button"
                            type="button"
                            disabled={savingId === lead.id}
                            onClick={() => openRequest(lead)}
                            aria-label={`View ${lead.firstName} ${lead.lastName}`}
                            title="View request"
                          >
                            {savingId === lead.id ? (
                              <Loader2 className="estimate-spin" size={15} />
                            ) : (
                              <ArrowRight size={16} />
                            )}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {selected && (
        <>
          <button
            className="admin-drawer-scrim"
            type="button"
            onClick={closeRequest}
            aria-label="Close estimate request details"
          />
          <aside className="admin-drawer leads-drawer">
            <div className="admin-drawer-header">
              <div>
                <span>
                  {selected.requestNumber
                    ? `Request ${selected.requestNumber}`
                    : "Estimate request"}
                </span>
                <h2>
                  {selected.firstName} {selected.lastName}
                </h2>
              </div>
              <button type="button" onClick={closeRequest}>
                ×
              </button>
            </div>
            <div className="leads-drawer-status">
              <span>Status</span>
              <select
                value={selected.status}
                disabled={savingId === selected.id}
                onChange={(event) =>
                  changeStatus(selected, event.target.value as LeadStatus)
                }
              >
                {INTAKE_STATUS_OPTIONS.map((value) => (
                  <option value={value} key={value}>
                    {LEAD_STATUS_LABELS[value]}
                  </option>
                ))}
              </select>
            </div>

            <div className="leads-contact-grid">
              <a href={`tel:${selected.phone}`}>
                <Phone size={17} />
                <span>
                  <small>Phone</small>
                  {selected.phone}
                </span>
              </a>
              <a href={`mailto:${selected.email}`}>
                <Mail size={17} />
                <span>
                  <small>Email</small>
                  {selected.email}
                </span>
              </a>
            </div>

            <section className="leads-detail-section">
              <span>Property and request</span>
              <div>
                <MapPin size={17} />
                <p>{selected.propertyAddress?.fullLine}</p>
              </div>
              <div>
                <CalendarPlus size={17} />
                <p>
                  {serviceLabel(selected.service)} ·{" "}
                  {selected.urgency.replaceAll("_", " ")}
                </p>
              </div>
              {selected.message && (
                <div>
                  <MessageSquareText size={17} />
                  <p>{selected.message}</p>
                </div>
              )}
            </section>

            <section className="leads-detail-section">
              <span>Intake context</span>
              <dl>
                <div>
                  <dt>Preferred contact</dt>
                  <dd>{selected.preferredContact}</dd>
                </div>
                <div>
                  <dt>Property type</dt>
                  <dd>{selected.propertyType}</dd>
                </div>
                <div>
                  <dt>Source</dt>
                  <dd>{selected.source}</dd>
                </div>
                <div>
                  <dt>Reference</dt>
                  <dd>{selected.requestNumber || selected.id.slice(0, 8)}</dd>
                </div>
                <div>
                  <dt>Received</dt>
                  <dd>{formatDate(selected.createdAt)}</dd>
                </div>
              </dl>
            </section>

            <div className="leads-handoff-note">
              <strong>Ready to move forward?</strong>
              <span>
                Conversion creates a pending job and its first estimate. Future
                pricing, revisions, and delivery continue from that job.
              </span>
            </div>

            <div className="admin-drawer-actions">
              <button
                className="admin-primary-button"
                type="button"
                disabled={savingId === selected.id}
                onClick={() => convertToJob(selected)}
              >
                {savingId === selected.id
                  ? "Creating job and estimate…"
                  : "Convert to job"}
                <ArrowRight size={16} />
              </button>
            </div>
          </aside>
        </>
      )}
    </main>
  );
}
