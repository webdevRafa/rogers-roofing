import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  ArrowRight,
  BriefcaseBusiness,
  CalendarDays,
  Filter,
  MapPin,
  Plus,
  Search,
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
import type { FieldValue } from "firebase/firestore";

import { useOrg } from "../contexts/OrgContext";
import { db } from "../firebase/firebaseConfig";
import type { Employee, Job, JobStatus } from "../types/types";
import { jobConverter } from "../types/types";
import { makeAddress, recomputeJob } from "../utils/calc";

type ProjectType = NonNullable<Job["projectType"]>;
type Priority = NonNullable<Job["priority"]>;

type JobForm = {
  address: string;
  customerName: string;
  email: string;
  phone: string;
  projectType: ProjectType;
  priority: Priority;
  feltDate: string;
  installDate: string;
  punchDate: string;
  assignedEmployeeIds: string[];
};

const initialForm: JobForm = {
  address: "",
  customerName: "",
  email: "",
  phone: "",
  projectType: "replacement",
  priority: "normal",
  feltDate: "",
  installDate: "",
  punchDate: "",
  assignedEmployeeIds: [],
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
  return null;
}

function formatDate(value: unknown): string {
  const date = toDate(value);
  if (!date) return "—";
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
    maximumFractionDigits: 0,
  });
}

function addressLine(job: Job): string {
  if (typeof job.address === "string") return job.address;
  return job.address?.fullLine || "Address not added";
}

function projectLabel(projectType?: Job["projectType"]): string {
  const labels: Record<ProjectType, string> = {
    replacement: "Roof replacement",
    repair: "Roof repair",
    storm_restoration: "Storm restoration",
    new_install: "New installation",
    commercial: "Commercial roofing",
    maintenance: "Maintenance",
  };
  return projectType ? labels[projectType] : "Roofing project";
}

export default function JobsPage() {
  const { orgId, loading: orgLoading } = useOrg();
  const [searchParams, setSearchParams] = useSearchParams();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<JobStatus | "all">("all");
  const [projectType, setProjectType] = useState<ProjectType | "all">("all");
  const [form, setForm] = useState<JobForm>(initialForm);
  const [formOpen, setFormOpen] = useState(searchParams.get("create") === "1");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setFormOpen(searchParams.get("create") === "1");
  }, [searchParams]);

  useEffect(() => {
    if (!orgId) {
      setLoading(false);
      return;
    }

    let ready = 0;
    const markReady = () => {
      ready += 1;
      if (ready >= 2) setLoading(false);
    };
    const jobsQuery = query(
      collection(db, "jobs").withConverter(jobConverter),
      where("orgId", "==", orgId)
    );
    const employeeQuery = query(
      collection(db, "employees"),
      where("orgId", "==", orgId)
    );

    const unsubscribeJobs = onSnapshot(
      jobsQuery,
      (snapshot) => {
        setJobs(snapshot.docs.map((document) => document.data()));
        markReady();
      },
      (snapshotError) => {
        setError(snapshotError.message);
        markReady();
      }
    );
    const unsubscribeEmployees = onSnapshot(
      employeeQuery,
      (snapshot) => {
        setEmployees(
          snapshot.docs.map((document) => ({
            id: document.id,
            ...(document.data() as Omit<Employee, "id">),
          }))
        );
        markReady();
      },
      (snapshotError) => {
        setError(snapshotError.message);
        markReady();
      }
    );

    return () => {
      unsubscribeJobs();
      unsubscribeEmployees();
    };
  }, [orgId]);

  const filteredJobs = useMemo(() => {
    const term = search.trim().toLowerCase();
    return [...jobs]
      .filter((job) => status === "all" || job.status === status)
      .filter(
        (job) => projectType === "all" || job.projectType === projectType
      )
      .filter((job) => {
        if (!term) return true;
        return [
          addressLine(job),
          job.customer?.name,
          job.customer?.email,
          job.customer?.phone,
          projectLabel(job.projectType),
          job.status,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(term);
      })
      .sort(
        (a, b) =>
          (toDate(b.updatedAt ?? b.createdAt)?.getTime() ?? 0) -
          (toDate(a.updatedAt ?? a.createdAt)?.getTime() ?? 0)
      );
  }, [jobs, projectType, search, status]);

  const totals = useMemo(
    () => ({
      active: jobs.filter(
        (job) => !["closed", "completed", "archived"].includes(job.status)
      ).length,
      scheduled: jobs.filter(
        (job) =>
          toDate(job.feltScheduledFor) ||
          toDate(job.shinglesScheduledFor) ||
          toDate(job.punchScheduledFor)
      ).length,
      revenue: jobs.reduce(
        (sum, job) => sum + (job.earnings?.totalEarningsCents ?? 0),
        0
      ),
      profit: jobs.reduce(
        (sum, job) => sum + (job.computed?.netProfitCents ?? 0),
        0
      ),
    }),
    [jobs]
  );

  function closeForm() {
    setFormOpen(false);
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete("create");
      return next;
    });
  }

  async function createJob(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!orgId) return;

    setSaving(true);
    setError(null);
    try {
      const newRef = doc(collection(db, "jobs"));
      const draft: Job = {
        id: newRef.id,
        orgId,
        status: "pending",
        projectType: form.projectType,
        priority: form.priority,
        address: makeAddress(form.address),
        customer: {
          name: form.customerName.trim(),
          email: form.email.trim(),
          phone: form.phone.trim(),
        },
        assignedEmployeeIds: form.assignedEmployeeIds,
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
        summaryNotes: "",
        attachments: [],
        ...(form.feltDate
          ? { feltScheduledFor: new Date(`${form.feltDate}T12:00:00`) }
          : {}),
        ...(form.installDate
          ? { shinglesScheduledFor: new Date(`${form.installDate}T12:00:00`) }
          : {}),
        ...(form.punchDate
          ? { punchScheduledFor: new Date(`${form.punchDate}T12:00:00`) }
          : {}),
        createdAt: serverTimestamp() as unknown as FieldValue,
        updatedAt: serverTimestamp() as unknown as FieldValue,
        computed: {
          totalExpensesCents: 0,
          netProfitCents: 0,
        },
      };
      await setDoc(newRef.withConverter(jobConverter), recomputeJob(draft));
      setForm(initialForm);
      closeForm();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving(false);
    }
  }

  async function changeStatus(job: Job, nextStatus: JobStatus) {
    setError(null);
    try {
      await updateDoc(doc(db, "jobs", job.id), {
        status: nextStatus,
        updatedAt: serverTimestamp(),
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  if (loading || orgLoading) {
    return (
      <div className="admin-loading">
        <div>
          <span />
          Loading jobs…
        </div>
      </div>
    );
  }

  return (
    <main className="admin-page jobs-page">
      <div className="admin-content-width">
        <header className="admin-page-header">
          <div>
            <span className="admin-kicker">Project operations</span>
            <h1>Jobs</h1>
            <p>
              Search every property, understand job health at a glance, and open
              a dedicated workspace for production, documents, costs, and
              closeout.
            </p>
          </div>
          <button
            className="admin-primary-button"
            type="button"
            onClick={() => {
              setFormOpen(true);
              setSearchParams((current) => {
                const next = new URLSearchParams(current);
                next.set("create", "1");
                return next;
              });
            }}
          >
            <Plus size={16} />
            Add job
          </button>
        </header>

        <section className="jobs-metrics">
          <article>
            <BriefcaseBusiness />
            <span>Active jobs</span>
            <strong>{totals.active}</strong>
          </article>
          <article>
            <CalendarDays />
            <span>Scheduled</span>
            <strong>{totals.scheduled}</strong>
          </article>
          <article>
            <span>Recorded revenue</span>
            <strong>{money(totals.revenue)}</strong>
          </article>
          <article>
            <span>Net profit</span>
            <strong>{money(totals.profit)}</strong>
          </article>
        </section>

        <section className="admin-card jobs-workspace">
          <div className="admin-toolbar">
            <label className="admin-search-field">
              <Search size={16} />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search address, customer, email, or phone"
              />
            </label>
            <span className="jobs-filter-icon">
              <Filter size={15} />
            </span>
            <select
              className="admin-filter-select"
              value={status}
              onChange={(event) =>
                setStatus(event.target.value as JobStatus | "all")
              }
            >
              <option value="all">All statuses</option>
              {[
                "draft",
                "pending",
                "active",
                "invoiced",
                "paid",
                "completed",
                "closed",
                "archived",
              ].map((option) => (
                <option value={option} key={option}>
                  {option.charAt(0).toUpperCase() + option.slice(1)}
                </option>
              ))}
            </select>
            <select
              className="admin-filter-select"
              value={projectType}
              onChange={(event) =>
                setProjectType(event.target.value as ProjectType | "all")
              }
            >
              <option value="all">All project types</option>
              {[
                "replacement",
                "repair",
                "storm_restoration",
                "new_install",
                "commercial",
                "maintenance",
              ].map((option) => (
                <option value={option} key={option}>
                  {projectLabel(option as ProjectType)}
                </option>
              ))}
            </select>
            <span className="admin-toolbar-count">
              {filteredJobs.length} jobs
            </span>
          </div>

          {error && <div className="admin-inline-error">{error}</div>}

          {filteredJobs.length === 0 ? (
            <div className="admin-empty">
              <div>
                <BriefcaseBusiness size={34} />
                <strong>No matching jobs</strong>
                <p>
                  Adjust the filters, create a new job, or convert a qualified
                  customer lead.
                </p>
              </div>
            </div>
          ) : (
            <>
              <div className="jobs-table-wrap">
                <table className="admin-table jobs-table">
                  <thead>
                    <tr>
                      <th>Job / property</th>
                      <th>Customer</th>
                      <th>Status</th>
                      <th>Assigned</th>
                      <th>Revenue</th>
                      <th>Cost</th>
                      <th>Profit</th>
                      <th>Updated</th>
                      <th aria-label="Open" />
                    </tr>
                  </thead>
                  <tbody>
                    {filteredJobs.map((job) => {
                      const assigned = employees.filter((employee) =>
                        job.assignedEmployeeIds?.includes(employee.id)
                      );
                      const revenue = job.earnings?.totalEarningsCents ?? 0;
                      const costs = job.computed?.totalExpensesCents ?? 0;
                      return (
                        <tr key={job.id}>
                          <td>
                            <Link
                              className="jobs-address-link"
                              to={`/job/${job.id}`}
                            >
                              <span>
                                <MapPin size={16} />
                              </span>
                              <div>
                                <strong>{addressLine(job)}</strong>
                                <small>{projectLabel(job.projectType)}</small>
                              </div>
                            </Link>
                          </td>
                          <td>
                            <div className="admin-table-stack">
                              <strong>
                                {job.customer?.name || "Customer not linked"}
                              </strong>
                              <small>
                                {job.customer?.phone || job.customer?.email || "—"}
                              </small>
                            </div>
                          </td>
                          <td>
                            <select
                              className={`admin-status status-${job.status}`}
                              value={job.status}
                              onChange={(event) =>
                                changeStatus(job, event.target.value as JobStatus)
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
                              ].map((option) => (
                                <option value={option} key={option}>
                                  {option}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <div className="jobs-assignees">
                              {assigned.length ? (
                                <>
                                  <span>
                                    {assigned
                                      .slice(0, 2)
                                      .map((employee) => employee.name.charAt(0))
                                      .join("")}
                                  </span>
                                  <small>
                                    {assigned.length === 1
                                      ? assigned[0].name
                                      : `${assigned.length} members`}
                                  </small>
                                </>
                              ) : (
                                <small>Unassigned</small>
                              )}
                            </div>
                          </td>
                          <td>{money(revenue)}</td>
                          <td>{money(costs)}</td>
                          <td>
                            <strong
                              className={
                                (job.computed?.netProfitCents ?? 0) < 0
                                  ? "jobs-profit is-negative"
                                  : "jobs-profit"
                              }
                            >
                              {money(job.computed?.netProfitCents ?? 0)}
                            </strong>
                          </td>
                          <td>{formatDate(job.updatedAt ?? job.createdAt)}</td>
                          <td>
                            <Link
                              className="admin-row-button"
                              to={`/job/${job.id}`}
                              aria-label={`Open ${addressLine(job)}`}
                            >
                              <ArrowRight size={16} />
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      </div>

      {formOpen && (
        <>
          <button
            className="admin-drawer-scrim"
            type="button"
            onClick={closeForm}
            aria-label="Close new job form"
          />
          <aside className="admin-drawer job-form-drawer">
            <div className="admin-drawer-header">
              <div>
                <span>New project</span>
                <h2>Add a roofing job</h2>
              </div>
              <button type="button" onClick={closeForm}>
                ×
              </button>
            </div>
            <form onSubmit={createJob}>
              <section className="drawer-form-section">
                <div className="drawer-form-heading">
                  <span>01</span>
                  <div>
                    <strong>Property and customer</strong>
                    <small>Identify where the work will happen.</small>
                  </div>
                </div>
                <label>
                  Job address *
                  <input
                    required
                    value={form.address}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        address: event.target.value,
                      }))
                    }
                    placeholder="Street, city, state, ZIP"
                  />
                </label>
                <label>
                  Customer name
                  <input
                    value={form.customerName}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        customerName: event.target.value,
                      }))
                    }
                  />
                </label>
                <div className="drawer-form-grid">
                  <label>
                    Email
                    <input
                      type="email"
                      value={form.email}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          email: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label>
                    Phone
                    <input
                      type="tel"
                      value={form.phone}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          phone: event.target.value,
                        }))
                      }
                    />
                  </label>
                </div>
              </section>

              <section className="drawer-form-section">
                <div className="drawer-form-heading">
                  <span>02</span>
                  <div>
                    <strong>Scope and priority</strong>
                    <small>Classify the project for the operations view.</small>
                  </div>
                </div>
                <div className="drawer-form-grid">
                  <label>
                    Project type
                    <select
                      value={form.projectType}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          projectType: event.target.value as ProjectType,
                        }))
                      }
                    >
                      {[
                        "replacement",
                        "repair",
                        "storm_restoration",
                        "new_install",
                        "commercial",
                        "maintenance",
                      ].map((option) => (
                        <option value={option} key={option}>
                          {projectLabel(option as ProjectType)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Priority
                    <select
                      value={form.priority}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          priority: event.target.value as Priority,
                        }))
                      }
                    >
                      <option value="normal">Normal</option>
                      <option value="high">High</option>
                      <option value="urgent">Urgent</option>
                    </select>
                  </label>
                </div>
              </section>

              <section className="drawer-form-section">
                <div className="drawer-form-heading">
                  <span>03</span>
                  <div>
                    <strong>Schedule and crew</strong>
                    <small>Optional dates can be added or changed later.</small>
                  </div>
                </div>
                <div className="drawer-form-grid drawer-form-grid-three">
                  <label>
                    Felt / dry-in
                    <input
                      type="date"
                      value={form.feltDate}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          feltDate: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label>
                    Installation
                    <input
                      type="date"
                      value={form.installDate}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          installDate: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label>
                    Final punch
                    <input
                      type="date"
                      value={form.punchDate}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          punchDate: event.target.value,
                        }))
                      }
                    />
                  </label>
                </div>
                <fieldset className="drawer-member-picker">
                  <legend>Assign members</legend>
                  {employees.filter((employee) => employee.isActive !== false)
                    .length === 0 ? (
                    <p>No active members are available yet.</p>
                  ) : (
                    employees
                      .filter((employee) => employee.isActive !== false)
                      .map((employee) => (
                        <label key={employee.id}>
                          <input
                            type="checkbox"
                            checked={form.assignedEmployeeIds.includes(employee.id)}
                            onChange={(event) =>
                              setForm((current) => ({
                                ...current,
                                assignedEmployeeIds: event.target.checked
                                  ? [
                                      ...current.assignedEmployeeIds,
                                      employee.id,
                                    ]
                                  : current.assignedEmployeeIds.filter(
                                      (id) => id !== employee.id
                                    ),
                              }))
                            }
                          />
                          <span>{employee.name}</span>
                          <small>{employee.role || "member"}</small>
                        </label>
                      ))
                  )}
                </fieldset>
              </section>

              {error && <div className="admin-inline-error">{error}</div>}
              <div className="admin-drawer-actions">
                <button
                  className="admin-primary-button"
                  type="submit"
                  disabled={saving}
                >
                  {saving ? "Creating job…" : "Create job workspace"}
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
