import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  BriefcaseBusiness,
  CalendarClock,
  CircleDollarSign,
  FileCheck2,
  HandCoins,
  Plus,
  TrendingUp,
  UserRoundSearch,
  Users,
} from "lucide-react";
import { collection, onSnapshot, query, where } from "firebase/firestore";

import { db } from "../firebase/firebaseConfig";
import { useOrg } from "../contexts/OrgContext";
import type { Employee, InvoiceDoc, Job, PayoutDoc } from "../types/types";
import type { CustomerLead } from "../domain/roofing";

type DatedValue = {
  toDate?: () => Date;
  seconds?: number;
};

function toDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const timestamp = value as DatedValue;
  if (typeof timestamp.toDate === "function") return timestamp.toDate();
  if (typeof timestamp.seconds === "number") {
    return new Date(timestamp.seconds * 1000);
  }
  return null;
}

function money(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function jobAddress(job: Job): string {
  if (typeof job.address === "string") return job.address;
  return job.address?.fullLine || "Address not added";
}

function shortDate(value: unknown): string {
  const date = toDate(value);
  if (!date) return "Not scheduled";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function customerName(job: Job): string {
  const extended = job as Job & {
    customer?: { name?: string };
  };
  return extended.customer?.name || "Customer not linked";
}

function requestServiceLabel(service: CustomerLead["service"]): string {
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

function isOpenIntakeRequest(lead: CustomerLead) {
  return (
    !lead.linkedJobId &&
    ["new", "contacted", "inspection_scheduled"].includes(lead.status)
  );
}

export default function AdminOverviewPage() {
  const { orgId, orgName, loading: orgLoading } = useOrg();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [payouts, setPayouts] = useState<PayoutDoc[]>([]);
  const [invoices, setInvoices] = useState<InvoiceDoc[]>([]);
  const [leads, setLeads] = useState<CustomerLead[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!orgId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    let readyCount = 0;
    const markReady = () => {
      readyCount += 1;
      if (readyCount >= 5) setLoading(false);
    };

    const unsubscribers = [
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
        query(collection(db, "invoices"), where("orgId", "==", orgId)),
        (snapshot) => {
          setInvoices(
            snapshot.docs.map((document) => ({
              id: document.id,
              ...(document.data() as Omit<InvoiceDoc, "id">),
            }))
          );
          markReady();
        },
        markReady
      ),
      onSnapshot(
        query(collection(db, "leads"), where("orgId", "==", orgId)),
        (snapshot) => {
          setLeads(
            snapshot.docs.map((document) => ({
              id: document.id,
              ...(document.data() as Omit<CustomerLead, "id">),
            }))
          );
          markReady();
        },
        markReady
      ),
    ];

    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [orgId]);

  const metrics = useMemo(() => {
    const bookedRevenue = jobs.reduce(
      (sum, job) => sum + (job.earnings?.totalEarningsCents ?? 0),
      0
    );
    const netProfit = jobs.reduce(
      (sum, job) => sum + (job.computed?.netProfitCents ?? 0),
      0
    );
    const outstanding = invoices
      .filter((invoice) => !["paid", "void"].includes(invoice.status))
      .reduce((sum, invoice) => sum + (invoice.money?.totalCents ?? 0), 0);
    const activeJobs = jobs.filter(
      (job) => !["closed", "completed", "archived"].includes(job.status)
    ).length;
    const openRequests = leads.filter(isOpenIntakeRequest).length;
    const unpaidPayouts = payouts
      .filter((payout) => !payout.paidAt)
      .reduce((sum, payout) => sum + (payout.amountCents ?? 0), 0);

    return {
      bookedRevenue,
      netProfit,
      outstanding,
      activeJobs,
      openRequests,
      unpaidPayouts,
    };
  }, [invoices, jobs, leads, payouts]);

  const recentJobs = useMemo(
    () =>
      [...jobs]
        .sort(
          (a, b) =>
            (toDate(b.updatedAt ?? b.createdAt)?.getTime() ?? 0) -
            (toDate(a.updatedAt ?? a.createdAt)?.getTime() ?? 0)
        )
        .slice(0, 6),
    [jobs]
  );

  const recentRequests = useMemo(
    () =>
      [...leads]
        .filter(isOpenIntakeRequest)
        .sort(
          (a, b) =>
            (toDate(b.createdAt)?.getTime() ?? 0) -
            (toDate(a.createdAt)?.getTime() ?? 0)
        )
        .slice(0, 5),
    [leads]
  );

  const upcoming = useMemo(() => {
    const now = Date.now();
    return jobs
      .flatMap((job) => [
        {
          id: `${job.id}-felt`,
          jobId: job.id,
          label: "Felt / dry-in",
          address: jobAddress(job),
          date: toDate(job.feltScheduledFor),
        },
        {
          id: `${job.id}-shingles`,
          jobId: job.id,
          label: "Roof installation",
          address: jobAddress(job),
          date: toDate(job.shinglesScheduledFor),
        },
        {
          id: `${job.id}-punch`,
          jobId: job.id,
          label: "Final punch",
          address: jobAddress(job),
          date: toDate(job.punchScheduledFor),
        },
      ])
      .filter((item) => item.date && item.date.getTime() >= now - 86_400_000)
      .sort((a, b) => (a.date?.getTime() ?? 0) - (b.date?.getTime() ?? 0))
      .slice(0, 5);
  }, [jobs]);

  if (loading || orgLoading) {
    return (
      <div className="admin-loading">
        <div>
          <span />
          Loading operations…
        </div>
      </div>
    );
  }

  if (!orgId) {
    return (
      <div className="admin-page">
        <div className="admin-card admin-empty">
          <div>
            <Users size={34} />
            <strong>No organization is connected</strong>
            <p>
              Ask an owner to add this account to the Roger&apos;s Roofing
              organization.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <main className="admin-page overview-page">
      <div className="admin-content-width">
        <header className="admin-page-header">
          <div>
            <span className="admin-kicker">Operations overview</span>
            <h1>Good morning.</h1>
            <p>
              Here is what is moving across {orgName || "Roger's Roofing"} right
              now.
            </p>
          </div>
          <div className="overview-header-actions">
            <Link className="admin-secondary-button" to="/leads">
              <UserRoundSearch size={16} />
              Review requests
            </Link>
            <Link className="admin-primary-button" to="/jobs?create=1">
              <Plus size={16} />
              Add job
            </Link>
          </div>
        </header>

        <section className="overview-metrics">
          <article className="overview-metric overview-metric-primary">
            <div>
              <span>Booked revenue</span>
              <strong>{money(metrics.bookedRevenue)}</strong>
              <small>Across {jobs.length} total jobs</small>
            </div>
            <CircleDollarSign />
          </article>
          <article className="overview-metric">
            <div>
              <span>Active jobs</span>
              <strong>{metrics.activeJobs}</strong>
              <small>Currently in production</small>
            </div>
            <BriefcaseBusiness />
          </article>
          <article className="overview-metric">
            <div>
              <span>Estimate requests</span>
              <strong>{metrics.openRequests}</strong>
              <small>Open and awaiting next steps</small>
            </div>
            <UserRoundSearch />
          </article>
          <article className="overview-metric">
            <div>
              <span>Outstanding</span>
              <strong>{money(metrics.outstanding)}</strong>
              <small>Issued but not marked paid</small>
            </div>
            <FileCheck2 />
          </article>
        </section>

        <section className="admin-card overview-requests-card">
          <div className="overview-card-heading">
            <div>
              <span>Incoming pipeline</span>
              <h2>Open estimate requests</h2>
            </div>
            <Link to="/leads">
              View request queue <ArrowRight size={14} />
            </Link>
          </div>

          {recentRequests.length === 0 ? (
            <div className="admin-empty">
              <div>
                <UserRoundSearch size={32} />
                <strong>The request inbox is clear</strong>
                <p>
                  New website requests will appear here. Converted requests
                  continue from their job workspace.
                </p>
              </div>
            </div>
          ) : (
            <div className="overview-request-list">
              {recentRequests.map((request) => (
                <Link
                  to={`/leads?request=${request.id}`}
                  key={request.id}
                  aria-label={`Open estimate request from ${request.firstName} ${request.lastName}`}
                >
                  <span className="overview-request-reference">
                    {request.requestNumber || "Website request"}
                  </span>
                  <div>
                    <strong>
                      {request.firstName} {request.lastName}
                    </strong>
                    <small>{request.propertyAddress?.fullLine}</small>
                  </div>
                  <div>
                    <strong>{requestServiceLabel(request.service)}</strong>
                    <small>{request.urgency.replaceAll("_", " ")}</small>
                  </div>
                  <span className={`admin-status status-${request.status}`}>
                    {request.status.replaceAll("_", " ")}
                  </span>
                  <time>{shortDate(request.createdAt)}</time>
                  <ArrowRight size={16} />
                </Link>
              ))}
            </div>
          )}
        </section>

        <section className="overview-grid">
          <article className="admin-card overview-jobs-card">
            <div className="overview-card-heading">
              <div>
                <span>Project pulse</span>
                <h2>Recently updated jobs</h2>
              </div>
              <Link to="/jobs">
                View all <ArrowRight size={14} />
              </Link>
            </div>

            {recentJobs.length === 0 ? (
              <div className="admin-empty">
                <div>
                  <BriefcaseBusiness size={32} />
                  <strong>No jobs yet</strong>
                  <p>Create the first job or convert a qualified lead.</p>
                </div>
              </div>
            ) : (
              <div className="overview-job-list">
                {recentJobs.map((job) => (
                  <Link to={`/job/${job.id}`} key={job.id}>
                    <div className="overview-job-address">
                      <span>{jobAddress(job)}</span>
                      <small>{customerName(job)}</small>
                    </div>
                    <span className={`admin-status status-${job.status}`}>
                      {job.status}
                    </span>
                    <div>
                      <span>{money(job.computed?.netProfitCents ?? 0)}</span>
                      <small>profit</small>
                    </div>
                    <div>
                      <span>{shortDate(job.updatedAt ?? job.createdAt)}</span>
                      <small>last updated</small>
                    </div>
                    <ArrowRight size={16} />
                  </Link>
                ))}
              </div>
            )}
          </article>

          <aside className="admin-card overview-schedule-card">
            <div className="overview-card-heading">
              <div>
                <span>Schedule</span>
                <h2>Coming up</h2>
              </div>
              <Link to="/schedule">
                Calendar <ArrowRight size={14} />
              </Link>
            </div>
            {upcoming.length === 0 ? (
              <div className="admin-empty">
                <div>
                  <CalendarClock size={32} />
                  <strong>Schedule is clear</strong>
                  <p>No upcoming installation or punch dates are recorded.</p>
                </div>
              </div>
            ) : (
              <div className="overview-schedule-list">
                {upcoming.map((item) => (
                  <Link to={`/job/${item.jobId}`} key={item.id}>
                    <time>
                      <strong>
                        {item.date?.toLocaleDateString("en-US", {
                          day: "2-digit",
                        })}
                      </strong>
                      <span>
                        {item.date?.toLocaleDateString("en-US", {
                          month: "short",
                        })}
                      </span>
                    </time>
                    <div>
                      <strong>{item.label}</strong>
                      <span>{item.address}</span>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </aside>
        </section>

        <section className="overview-bottom-grid">
          <article className="admin-card overview-finance-card">
            <div className="overview-card-heading">
              <div>
                <span>Financial health</span>
                <h2>Job economics</h2>
              </div>
              <Link to="/financial-overview">
                Open reports <ArrowRight size={14} />
              </Link>
            </div>
            <div className="overview-finance-values">
              <div>
                <TrendingUp />
                <span>Net profit</span>
                <strong>{money(metrics.netProfit)}</strong>
              </div>
              <div>
                <HandCoins />
                <span>Unpaid payouts</span>
                <strong>{money(metrics.unpaidPayouts)}</strong>
              </div>
              <div>
                <Users />
                <span>Active members</span>
                <strong>
                  {employees.filter((employee) => employee.isActive !== false).length}
                </strong>
              </div>
            </div>
          </article>

          <article className="admin-card overview-actions-card">
            <div className="overview-card-heading">
              <div>
                <span>Shortcuts</span>
                <h2>Move work forward</h2>
              </div>
            </div>
            <div className="overview-quick-actions">
              <Link to="/jobs?create=1">
                <Plus /> Create a job <ArrowRight />
              </Link>
              <Link to="/jobs">
                <BriefcaseBusiness /> Review job costs <ArrowRight />
              </Link>
              <Link to="/payouts">
                <HandCoins /> Record a payout <ArrowRight />
              </Link>
              <Link to="/invoices-page">
                <FileCheck2 /> Create a document <ArrowRight />
              </Link>
            </div>
          </article>
        </section>
      </div>
    </main>
  );
}
