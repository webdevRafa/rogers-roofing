import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowRight,
  CalendarPlus,
  Mail,
  MapPin,
  MessageSquareText,
  Phone,
  Search,
  UserRoundSearch,
} from "lucide-react";
import {
  collection,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";

import { useOrg } from "../contexts/OrgContext";
import { db } from "../firebase/firebaseConfig";
import {
  LEAD_STATUS_LABELS,
  type CustomerLead,
  type LeadStatus,
  type ProjectType,
  type RoofingService,
} from "../domain/roofing";
import type { FieldValue } from "firebase/firestore";
import type { Job } from "../types/types";
import { jobConverter } from "../types/types";
import { recomputeJob } from "../utils/calc";

type FsDate = { toDate?: () => Date; seconds?: number };

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

export default function LeadsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { orgId, loading: orgLoading } = useOrg();
  const [leads, setLeads] = useState<CustomerLead[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<LeadStatus | "all">("all");
  const [selected, setSelected] = useState<CustomerLead | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!orgId) {
      setLoading(false);
      return;
    }
    const leadsQuery = query(
      collection(db, "leads"),
      where("organizationId", "==", orgId)
    );
    return onSnapshot(
      leadsQuery,
      (snapshot) => {
        setLeads(
          snapshot.docs.map((document) => ({
            id: document.id,
            ...(document.data() as Omit<CustomerLead, "id">),
          }))
        );
        setLoading(false);
      },
      (snapshotError) => {
        setError(snapshotError.message);
        setLoading(false);
      }
    );
  }, [orgId]);

  const requestedLeadId = searchParams.get("request");

  useEffect(() => {
    if (!requestedLeadId) return;
    const requestedLead = leads.find((lead) => lead.id === requestedLeadId);
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

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return [...leads]
      .filter((lead) => status === "all" || lead.status === status)
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
  }, [leads, search, status]);

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
      const jobRef = doc(collection(db, "jobs"));
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

      await setDoc(jobRef.withConverter(jobConverter), job);
      await updateDoc(doc(db, "leads", lead.id), {
        status: "won",
        linkedJobId: jobRef.id,
        updatedAt: serverTimestamp(),
      });
      navigate(`/job/${jobRef.id}`);
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
              Every request from the public website is saved here in real time.
              Qualify the project, schedule an inspection, and convert approved
              opportunities into jobs.
            </p>
          </div>
          <div className="leads-summary">
            <span>{leads.filter((lead) => lead.status === "new").length}</span>
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
                setStatus(event.target.value as LeadStatus | "all")
              }
            >
              <option value="all">All statuses</option>
              {Object.entries(LEAD_STATUS_LABELS).map(([value, label]) => (
                <option value={value} key={value}>
                  {label}
                </option>
              ))}
            </select>
            <span className="admin-toolbar-count">
              {filtered.length}{" "}
              {filtered.length === 1 ? "request" : "requests"}
            </span>
          </div>

          {error && <div className="admin-inline-error">{error}</div>}

          {filtered.length === 0 ? (
            <div className="admin-empty">
              <div>
                <UserRoundSearch size={34} />
                <strong>No matching estimate requests</strong>
                <p>
                  New estimate requests submitted through the public website
                  will appear here.
                </p>
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
                          {Object.entries(LEAD_STATUS_LABELS).map(
                            ([value, label]) => (
                              <option value={value} key={value}>
                                {label}
                              </option>
                            )
                          )}
                        </select>
                      </td>
                      <td>
                        <button
                          className="admin-row-button"
                          type="button"
                          onClick={() => openRequest(lead)}
                          aria-label={`View ${lead.firstName} ${lead.lastName}`}
                        >
                          <ArrowRight size={16} />
                        </button>
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
                {Object.entries(LEAD_STATUS_LABELS).map(([value, label]) => (
                  <option value={value} key={value}>
                    {label}
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

            <div className="admin-drawer-actions">
              <button
                className="admin-primary-button"
                type="button"
                disabled={Boolean(selected.linkedJobId) || savingId === selected.id}
                onClick={() => convertToJob(selected)}
              >
                {selected.linkedJobId ? "Already converted" : "Convert to job"}
                <ArrowRight size={16} />
              </button>
            </div>
          </aside>
        </>
      )}
    </main>
  );
}
