import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import {
  ArrowRight,
  Banknote,
  CheckCircle2,
  FileDown,
  HandCoins,
  Plus,
  Search,
  Users,
} from "lucide-react";
import {
  collection,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import type { FieldValue } from "firebase/firestore";
import { useSearchParams } from "react-router-dom";

import { GlobalPayoutStubModal } from "../components/GlobalPayoutStubModal";
import { useOrg } from "../contexts/OrgContext";
import { db } from "../firebase/firebaseConfig";
import type { Employee, Job, PayoutDoc } from "../types/types";

type PayoutForm = {
  employeeId: string;
  jobId: string;
  category: PayoutDoc["category"];
  amount: string;
  method: PayoutDoc["method"];
  note: string;
};

const initialForm: PayoutForm = {
  employeeId: "",
  jobId: "",
  category: "shingles",
  amount: "",
  method: "check",
  note: "",
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
  });
}

function addressLine(job?: Job): string {
  if (!job) return "General payroll";
  if (typeof job.address === "string") return job.address;
  return job.address?.fullLine || "Address not added";
}

export default function PayoutsPage() {
  const [searchParams] = useSearchParams();
  const { orgId, loading: orgLoading } = useOrg();
  const [payouts, setPayouts] = useState<PayoutDoc[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [search, setSearch] = useState("");
  const [employeeFilter, setEmployeeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "paid" | "unpaid">(
    "all"
  );
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(initialForm);
  const [statementEmployee, setStatementEmployee] = useState<Employee | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const jobId = searchParams.get("jobId");
    if (jobId) {
      setForm((current) => ({ ...current, jobId }));
      setFormOpen(true);
    }
  }, [searchParams]);

  useEffect(() => {
    if (!orgId) {
      setLoading(false);
      return;
    }

    let ready = 0;
    const markReady = () => {
      ready += 1;
      if (ready >= 3) setLoading(false);
    };
    const unsubs = [
      onSnapshot(
        query(collection(db, "payouts"), where("orgId", "==", orgId)),
        (snapshot) => {
          setPayouts(
            snapshot.docs.map((document) => ({
              id: document.id,
              ...(document.data() as Omit<PayoutDoc, "id">),
            }))
          );
          markReady();
        },
        markReady
      ),
      onSnapshot(
        query(collection(db, "employees"), where("orgId", "==", orgId)),
        (snapshot) => {
          setEmployees(
            snapshot.docs.map((document) => ({
              id: document.id,
              ...(document.data() as Omit<Employee, "id">),
            }))
          );
          markReady();
        },
        markReady
      ),
      onSnapshot(
        query(collection(db, "jobs"), where("orgId", "==", orgId)),
        (snapshot) => {
          setJobs(
            snapshot.docs.map((document) => ({
              id: document.id,
              ...(document.data() as Omit<Job, "id">),
            }))
          );
          markReady();
        },
        markReady
      ),
    ];
    return () => unsubs.forEach((unsubscribe) => unsubscribe());
  }, [orgId]);

  const jobsById = useMemo(
    () => new Map(jobs.map((job) => [job.id, job])),
    [jobs]
  );

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return [...payouts]
      .filter(
        (payout) =>
          employeeFilter === "all" || payout.employeeId === employeeFilter
      )
      .filter((payout) => {
        if (statusFilter === "paid") return Boolean(payout.paidAt);
        if (statusFilter === "unpaid") return !payout.paidAt;
        return true;
      })
      .filter((payout) => {
        if (!term) return true;
        const job = payout.jobId ? jobsById.get(payout.jobId) : undefined;
        return [
          payout.employeeNameSnapshot,
          addressLine(job),
          payout.category,
          payout.method,
          payout.note,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(term);
      })
      .sort(
        (a, b) =>
          (toDate(b.paidAt ?? b.createdAt)?.getTime() ?? 0) -
          (toDate(a.paidAt ?? a.createdAt)?.getTime() ?? 0)
      );
  }, [employeeFilter, jobsById, payouts, search, statusFilter]);

  const summary = useMemo(() => {
    const paid = payouts.filter((payout) => payout.paidAt);
    const unpaid = payouts.filter((payout) => !payout.paidAt);
    return {
      total: payouts.reduce((sum, payout) => sum + payout.amountCents, 0),
      paid: paid.reduce((sum, payout) => sum + payout.amountCents, 0),
      unpaid: unpaid.reduce((sum, payout) => sum + payout.amountCents, 0),
      people: new Set(payouts.map((payout) => payout.employeeId)).size,
    };
  }, [payouts]);

  const statementPayouts = useMemo(
    () =>
      statementEmployee
        ? filtered.filter(
            (payout) => payout.employeeId === statementEmployee.id
          )
        : [],
    [filtered, statementEmployee]
  );

  async function createPayout(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!orgId) return;

    const employee = employees.find((item) => item.id === form.employeeId);
    const job = jobs.find((item) => item.id === form.jobId);
    const amount = Number(form.amount);
    if (!employee || !Number.isFinite(amount) || amount <= 0) {
      setError("Select a member and enter an amount greater than zero.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const payoutRef = doc(collection(db, "payouts"));
      const note = form.note.trim();
      const payout: Omit<PayoutDoc, "id"> = {
        orgId,
        jobId: job?.id || null,
        employeeId: employee.id,
        employeeNameSnapshot: employee.name,
        ...(job?.address !== undefined
          ? { jobAddressSnapshot: job.address }
          : {}),
        category: form.category,
        amountCents: Math.round(amount * 100),
        method: form.method,
        ...(note ? { note } : {}),
        createdAt: serverTimestamp() as unknown as FieldValue,
        paidAt: null,
      };
      await setDoc(payoutRef, payout);
      setForm(initialForm);
      setFormOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving(false);
    }
  }

  async function markStatementPaid() {
    if (statementPayouts.length === 0) return;
    setSaving(true);
    try {
      const batch = writeBatch(db);
      statementPayouts
        .filter((payout) => !payout.paidAt)
        .forEach((payout) => {
          batch.update(doc(db, "payouts", payout.id), {
            paidAt: serverTimestamp(),
          });
        });
      await batch.commit();
      setStatementEmployee(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving(false);
    }
  }

  if (loading || orgLoading) {
    return (
      <div className="admin-loading">
        <div>
          <span />
          Loading payroll history…
        </div>
      </div>
    );
  }

  return (
    <main className="admin-page payouts-page">
      <div className="admin-content-width">
        <header className="admin-page-header">
          <div>
            <span className="admin-kicker">Workforce payments</span>
            <h1>Payouts</h1>
            <p>
              Keep worker payments connected to the job, search payroll history
              by member or property, and print professional payout statements.
            </p>
          </div>
          <button
            className="admin-primary-button"
            type="button"
            onClick={() => setFormOpen(true)}
          >
            <Plus size={16} />
            Record payout
          </button>
        </header>

        <section className="payout-summary">
          <article className="payout-summary-primary">
            <HandCoins />
            <span>Total recorded</span>
            <strong>{money(summary.total)}</strong>
          </article>
          <article>
            <CheckCircle2 />
            <span>Paid</span>
            <strong>{money(summary.paid)}</strong>
          </article>
          <article>
            <Banknote />
            <span>Awaiting payment</span>
            <strong>{money(summary.unpaid)}</strong>
          </article>
          <article>
            <Users />
            <span>Members paid</span>
            <strong>{summary.people}</strong>
          </article>
        </section>

        <section className="admin-card payout-workspace">
          <div className="admin-toolbar">
            <label className="admin-search-field">
              <Search size={16} />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search member, property, category, or method"
              />
            </label>
            <select
              className="admin-filter-select"
              value={employeeFilter}
              onChange={(event) => setEmployeeFilter(event.target.value)}
            >
              <option value="all">All members</option>
              {employees.map((employee) => (
                <option value={employee.id} key={employee.id}>
                  {employee.name}
                </option>
              ))}
            </select>
            <select
              className="admin-filter-select"
              value={statusFilter}
              onChange={(event) =>
                setStatusFilter(event.target.value as "all" | "paid" | "unpaid")
              }
            >
              <option value="all">All payment states</option>
              <option value="unpaid">Awaiting payment</option>
              <option value="paid">Paid</option>
            </select>
            {employeeFilter !== "all" && filtered.length > 0 && (
              <button
                className="admin-secondary-button"
                type="button"
                onClick={() =>
                  setStatementEmployee(
                    employees.find((employee) => employee.id === employeeFilter) ??
                      null
                  )
                }
              >
                <FileDown size={15} />
                Statement
              </button>
            )}
          </div>

          {error && <div className="admin-inline-error">{error}</div>}

          {filtered.length === 0 ? (
            <div className="admin-empty">
              <div>
                <HandCoins size={34} />
                <strong>No matching payouts</strong>
                <p>
                  Record labor or technician payouts and link them to the
                  property whenever possible.
                </p>
              </div>
            </div>
          ) : (
            <div className="payout-table-wrap">
              <table className="admin-table payout-table">
                <thead>
                  <tr>
                    <th>Member</th>
                    <th>Job / property</th>
                    <th>Category</th>
                    <th>Method</th>
                    <th>Created</th>
                    <th>Paid</th>
                    <th>Amount</th>
                    <th aria-label="Statement" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((payout) => {
                    const employee = employees.find(
                      (item) => item.id === payout.employeeId
                    );
                    const job = payout.jobId
                      ? jobsById.get(payout.jobId)
                      : undefined;
                    return (
                      <tr key={payout.id}>
                        <td>
                          <div className="admin-table-primary">
                            <span>
                              {payout.employeeNameSnapshot
                                .split(/\s+/)
                                .slice(0, 2)
                                .map((part) => part.charAt(0))
                                .join("")}
                            </span>
                            <div>
                              <strong>{payout.employeeNameSnapshot}</strong>
                              <small>{employee?.role || "member"}</small>
                            </div>
                          </div>
                        </td>
                        <td>
                          <div className="admin-table-stack">
                            <strong>{addressLine(job)}</strong>
                            <small>
                              {payout.jobId ? `Job ${payout.jobId.slice(0, 7)}` : "Not job linked"}
                            </small>
                          </div>
                        </td>
                        <td className="payout-capitalize">{payout.category}</td>
                        <td className="payout-capitalize">{payout.method}</td>
                        <td>{formatDate(payout.createdAt)}</td>
                        <td>
                          <span
                            className={
                              payout.paidAt
                                ? "admin-status status-paid"
                                : "admin-status status-pending"
                            }
                          >
                            {payout.paidAt
                              ? formatDate(payout.paidAt)
                              : "Awaiting"}
                          </span>
                        </td>
                        <td>
                          <strong className="payout-amount">
                            {money(payout.amountCents)}
                          </strong>
                        </td>
                        <td>
                          <button
                            className="admin-row-button"
                            type="button"
                            onClick={() => setStatementEmployee(employee ?? null)}
                            aria-label={`Open statement for ${payout.employeeNameSnapshot}`}
                          >
                            <FileDown size={15} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {formOpen && (
        <>
          <button
            className="admin-drawer-scrim"
            type="button"
            onClick={() => setFormOpen(false)}
            aria-label="Close payout form"
          />
          <aside className="admin-drawer payout-form-drawer">
            <div className="admin-drawer-header">
              <div>
                <span>Payroll entry</span>
                <h2>Record a payout</h2>
              </div>
              <button type="button" onClick={() => setFormOpen(false)}>
                ×
              </button>
            </div>
            <form onSubmit={createPayout}>
              <section className="drawer-form-section">
                <div className="drawer-form-heading">
                  <span>01</span>
                  <div>
                    <strong>Member and job</strong>
                    <small>Connect this payment to the work that earned it.</small>
                  </div>
                </div>
                <label>
                  Member *
                  <select
                    required
                    value={form.employeeId}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        employeeId: event.target.value,
                      }))
                    }
                  >
                    <option value="">Select a member</option>
                    {employees
                      .filter((employee) => employee.isActive !== false)
                      .map((employee) => (
                        <option value={employee.id} key={employee.id}>
                          {employee.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  Job / property
                  <select
                    value={form.jobId}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        jobId: event.target.value,
                      }))
                    }
                  >
                    <option value="">General payroll / not job linked</option>
                    {jobs.map((job) => (
                      <option value={job.id} key={job.id}>
                        {addressLine(job)}
                      </option>
                    ))}
                  </select>
                </label>
              </section>

              <section className="drawer-form-section">
                <div className="drawer-form-heading">
                  <span>02</span>
                  <div>
                    <strong>Payment details</strong>
                    <small>Record the gross payout amount and method.</small>
                  </div>
                </div>
                <div className="drawer-form-grid">
                  <label>
                    Category
                    <select
                      value={form.category}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          category: event.target.value as PayoutDoc["category"],
                        }))
                      }
                    >
                      <option value="shingles">Shingles / installation</option>
                      <option value="felt">Felt / dry-in</option>
                      <option value="technician">Technician / service</option>
                    </select>
                  </label>
                  <label>
                    Method
                    <select
                      value={form.method}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          method: event.target.value as PayoutDoc["method"],
                        }))
                      }
                    >
                      <option value="check">Check</option>
                      <option value="cash">Cash</option>
                      <option value="zelle">Zelle</option>
                      <option value="other">Other</option>
                    </select>
                  </label>
                </div>
                <label>
                  Amount ($) *
                  <input
                    required
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={form.amount}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        amount: event.target.value,
                      }))
                    }
                  />
                </label>
                <label>
                  Payment note
                  <input
                    value={form.note}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        note: event.target.value,
                      }))
                    }
                    placeholder="Scope, week, check number, or context"
                  />
                </label>
              </section>

              {error && <div className="admin-inline-error">{error}</div>}
              <div className="admin-drawer-actions">
                <button
                  className="admin-primary-button"
                  type="submit"
                  disabled={saving}
                >
                  {saving ? "Recording payout…" : "Record payout"}
                  {!saving && <ArrowRight size={16} />}
                </button>
              </div>
            </form>
          </aside>
        </>
      )}

      {statementEmployee && statementPayouts.length > 0 && (
        <GlobalPayoutStubModal
          employee={statementEmployee}
          payouts={statementPayouts}
          saving={saving}
          onClose={() => setStatementEmployee(null)}
          onConfirmPaid={markStatementPaid}
        />
      )}
    </main>
  );
}
