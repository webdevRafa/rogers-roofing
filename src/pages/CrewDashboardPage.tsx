import { useEffect, useMemo, useState } from "react";
import {
  collection,
  query,
  where,
  onSnapshot,
  orderBy,
} from "firebase/firestore";
import { useNavigate } from "react-router-dom";
import { db } from "../firebase/firebaseConfig";
import { useCurrentEmployee } from "../hooks/useCurrentEmployee";
import type { Job, PayoutStubDoc } from "../types/types";

/**
 * Formats a cent-based integer into a USD currency string.  If the
 * value is undefined or null the result will default to $0.00.
 */
function money(cents?: number | null): string {
  const v = typeof cents === "number" ? cents : 0;
  return (v / 100).toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
  });
}

/**
 * CrewDashboardPage presents a personalised overview for crew members and
 * managers.  Jobs are grouped into sections based on their status so
 * upcoming/active work is separate from completed or closed jobs.
 * A simple payout history section surfaces recent pay stubs associated
 * with the logged‑in crew member.  Managers see all jobs; crew only see
 * jobs assigned to them.  The component listens for real‑time Firestore
 * updates so lists stay fresh without manual reloads.
 */
export default function CrewDashboardPage() {
  const { employee, loading } = useCurrentEmployee();
  const navigate = useNavigate();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [jobsLoading, setJobsLoading] = useState(true);
  const [jobsError, setJobsError] = useState<string | null>(null);
  const [stubs, setStubs] = useState<PayoutStubDoc[]>([]);
  const [stubsLoading, setStubsLoading] = useState(true);
  const [stubsError, setStubsError] = useState<string | null>(null);

  // Load jobs relevant to the current user.  Managers see all jobs
  // whereas crew/readOnly users see only jobs they are assigned to.
  useEffect(() => {
    if (loading) return;
    if (!employee || !employee.accessRole) {
      setJobs([]);
      setJobsLoading(false);
      return;
    }
    setJobsLoading(true);
    setJobsError(null);
    // Managers: see all jobs ordered by creation date
    if (employee.accessRole === "manager") {
      const q = query(collection(db, "jobs"), orderBy("createdAt", "desc"));
      const unsub = onSnapshot(
        q,
        (snap) => {
          const list = snap.docs.map((d) => ({
            id: d.id,
            ...(d.data() as Omit<Job, "id">),
          }));
          setJobs(list);
          setJobsLoading(false);
        },
        (err) => {
          console.error(err);
          setJobsError(err.message || "Failed to load jobs.");
          setJobs([]);
          setJobsLoading(false);
        }
      );
      return () => unsub();
    }
    // Crew/readOnly: only jobs where the employeeId appears in assignedEmployeeIds
    const q = query(
      collection(db, "jobs"),
      where("assignedEmployeeIds", "array-contains", employee.id),
      orderBy("createdAt", "desc")
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<Job, "id">),
        }));
        setJobs(list);
        setJobsLoading(false);
      },
      (err) => {
        console.error(err);
        setJobsError(err.message || "Failed to load assigned jobs.");
        setJobs([]);
        setJobsLoading(false);
      }
    );
    return () => unsub();
  }, [employee, loading]);

  // Subscribe to payout stubs for the current employee to build a
  // payout history.  The stubs collection uses employeeId to store
  // which crew member was paid.
  useEffect(() => {
    if (loading) return;
    if (!employee || !employee.id) {
      setStubs([]);
      setStubsLoading(false);
      return;
    }
    setStubsLoading(true);
    setStubsError(null);
    const ref = collection(db, "payoutStubs");
    const q = query(
      ref,
      where("employeeId", "==", employee.id),
      orderBy("createdAt", "desc")
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: PayoutStubDoc[] = snap.docs.map((d) => {
          const data = d.data() as PayoutStubDoc;
          return { ...data, id: d.id };
        });
        setStubs(list);
        setStubsLoading(false);
      },
      (err) => {
        console.error(err);
        setStubsError(err.message || "Failed to load payout history.");
        setStubs([]);
        setStubsLoading(false);
      }
    );
    return () => unsub();
  }, [employee, loading]);

  // Sort jobs by last updated timestamp or createdAt for consistent ordering
  const sortedJobs = useMemo(() => {
    return [...jobs].sort((a, b) => {
      const aDate: any = a.updatedAt || a.createdAt;
      const bDate: any = b.updatedAt || b.createdAt;
      const aTime = aDate?.toMillis?.() || aDate?.getTime?.() || 0;
      const bTime = bDate?.toMillis?.() || bDate?.getTime?.() || 0;
      return bTime - aTime;
    });
  }, [jobs]);

  // Categorise jobs into pending/active, completed/closed and other
  const pendingJobs = useMemo(() => {
    return sortedJobs.filter((job) =>
      ["active", "pending", "invoiced", "draft"].includes(job.status)
    );
  }, [sortedJobs]);
  const completedJobs = useMemo(() => {
    return sortedJobs.filter((job) =>
      ["paid", "closed", "completed"].includes(job.status)
    );
  }, [sortedJobs]);
  const otherJobs = useMemo(() => {
    return sortedJobs.filter(
      (job) =>
        !["active", "pending", "invoiced", "draft"].includes(job.status) &&
        !["paid", "closed", "completed"].includes(job.status)
    );
  }, [sortedJobs]);

  if (loading || jobsLoading) {
    return <div className="py-10 text-center text-gray-500">Loading jobs…</div>;
  }
  if (jobsError) {
    return <div className="py-10 text-center text-red-600">{jobsError}</div>;
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-4">My Jobs</h1>
      {pendingJobs.length === 0 &&
      completedJobs.length === 0 &&
      otherJobs.length === 0 ? (
        <p className="text-gray-500">No jobs found.</p>
      ) : (
        <>
          {pendingJobs.length > 0 && (
            <section className="mb-6">
              <h2 className="text-lg font-semibold mb-2">
                Upcoming &amp; Active Jobs
              </h2>
              <ul className="space-y-4">
                {pendingJobs.map((job) => {
                  const address =
                    job.address?.fullLine || job.address?.street || "";
                  const status = job.status;
                  const feltScheduled = job.feltScheduledFor;
                  const feltCompleted = job.feltCompletedAt;
                  const shinglesScheduled = job.shinglesScheduledFor;
                  const shinglesCompleted = job.shinglesCompletedAt;
                  const punchScheduled = job.punchScheduledFor;
                  const punchCompleted = job.punchedAt;
                  return (
                    <li
                      key={job.id}
                      className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm hover:bg-gray-50 transition cursor-pointer"
                      onClick={() => navigate(`/crew/job/${job.id}`)}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="text-lg font-medium text-gray-900">
                            {address || "Unassigned address"}
                          </h3>
                          <p className="text-sm text-gray-600 capitalize">
                            Status: {status}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={(ev) => {
                            ev.stopPropagation();
                            navigate(`/crew/job/${job.id}`);
                          }}
                          className="rounded-md bg-cyan-700 px-3 py-1.5 text-sm text-white hover:bg-cyan-600"
                        >
                          View
                        </button>
                      </div>
                      {/* Task summary for active jobs */}
                      <div className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs text-gray-700">
                        <div>
                          <strong>Felt:</strong>{" "}
                          {feltCompleted
                            ? "Completed"
                            : feltScheduled
                            ? "Scheduled"
                            : "Not scheduled"}
                        </div>
                        <div>
                          <strong>Shingles:</strong>{" "}
                          {shinglesCompleted
                            ? "Completed"
                            : shinglesScheduled
                            ? "Scheduled"
                            : "Not scheduled"}
                        </div>
                        <div>
                          <strong>Punch:</strong>{" "}
                          {punchCompleted
                            ? "Completed"
                            : punchScheduled
                            ? "Scheduled"
                            : "Not scheduled"}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
          {completedJobs.length > 0 && (
            <section className="mb-6">
              <h2 className="text-lg font-semibold mb-2">
                Completed / Closed Jobs
              </h2>
              <ul className="space-y-4">
                {completedJobs.map((job) => {
                  const address =
                    job.address?.fullLine || job.address?.street || "";
                  const status = job.status;
                  return (
                    <li
                      key={job.id}
                      className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm hover:bg-gray-50 transition cursor-pointer"
                      onClick={() => navigate(`/crew/job/${job.id}`)}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="text-lg font-medium text-gray-900">
                            {address || "Unassigned address"}
                          </h3>
                          <p className="text-sm text-gray-600 capitalize">
                            Status: {status}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={(ev) => {
                            ev.stopPropagation();
                            navigate(`/crew/job/${job.id}`);
                          }}
                          className="rounded-md bg-cyan-700 px-3 py-1.5 text-sm text-white hover:bg-cyan-600"
                        >
                          View
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
          {otherJobs.length > 0 && (
            <section className="mb-6">
              <h2 className="text-lg font-semibold mb-2">Other Jobs</h2>
              <ul className="space-y-4">
                {otherJobs.map((job) => {
                  const address =
                    job.address?.fullLine || job.address?.street || "";
                  const status = job.status;
                  return (
                    <li
                      key={job.id}
                      className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm hover:bg-gray-50 transition cursor-pointer"
                      onClick={() => navigate(`/crew/job/${job.id}`)}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="text-lg font-medium text-gray-900">
                            {address || "Unassigned address"}
                          </h3>
                          <p className="text-sm text-gray-600 capitalize">
                            Status: {status}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={(ev) => {
                            ev.stopPropagation();
                            navigate(`/crew/job/${job.id}`);
                          }}
                          className="rounded-md bg-cyan-700 px-3 py-1.5 text-sm text-white hover:bg-cyan-600"
                        >
                          View
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </>
      )}

      {/* Payout history */}
      <section className="mt-8">
        <h2 className="text-lg font-semibold mb-2">Payout History</h2>
        {stubsLoading && (
          <p className="text-gray-500 text-sm">Loading payout history…</p>
        )}
        {stubsError && <p className="text-red-600 text-sm">{stubsError}</p>}
        {!stubsLoading && !stubsError && stubs.length === 0 && (
          <p className="text-gray-500 text-sm">No payout history found.</p>
        )}
        {!stubsLoading && !stubsError && stubs.length > 0 && (
          <ul className="space-y-3">
            {stubs.map((s) => {
              let createdDate = "";
              try {
                const val: any = s.createdAt;
                if (val?.toDate) {
                  createdDate = val.toDate().toLocaleDateString();
                } else if (val instanceof Date) {
                  createdDate = val.toLocaleDateString();
                }
              } catch (e) {
                createdDate = "";
              }
              return (
                <li
                  key={s.id}
                  className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-medium text-gray-900">
                        {s.number}
                      </h3>
                      <p className="text-xs text-gray-500">
                        {createdDate ? `Created ${createdDate}` : ""}
                      </p>
                    </div>
                    <div className="text-sm font-semibold text-gray-900">
                      {money(s.totalCents)}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
