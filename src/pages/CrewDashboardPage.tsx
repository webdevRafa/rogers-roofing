import { useEffect, useMemo, useState } from "react";
import {
  collection,
  query,
  where,
  onSnapshot,
  orderBy,
  doc,
  getDoc,
} from "firebase/firestore";
import { useNavigate } from "react-router-dom";
import { db } from "../firebase/firebaseConfig";
import { useCurrentEmployee } from "../hooks/useCurrentEmployee";
import type { Job, PayoutDoc } from "../types/types";

/**
 * CrewDashboardPage displays a list of jobs relevant to the currently
 * logged-in employee. Crew members (accessRole === 'crew' or 'readOnly')
 * see only jobs for which they have payout records. Supervisors and
 * managers (accessRole === 'manager') see all jobs, but sensitive
 * financial data is omitted.
 */
export default function CrewDashboardPage() {
  const { employee, loading } = useCurrentEmployee();
  const navigate = useNavigate();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [jobsLoading, setJobsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Helper to fetch jobs by IDs once we know them
  async function fetchJobsByIds(jobIds: string[]) {
    const promises = jobIds.map(async (id) => {
      const docRef = doc(db, "jobs", id);
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        return { id: snap.id, ...(snap.data() as Omit<Job, "id">) } as Job;
      }
      return null;
    });
    const all = await Promise.all(promises);
    return all.filter(Boolean) as Job[];
  }

  useEffect(() => {
    if (loading) return;
    // If no employee or no accessRole, skip
    if (!employee || !employee.accessRole) {
      setJobs([]);
      setJobsLoading(false);
      return;
    }
    setJobsLoading(true);
    setError(null);
    // For managers: subscribe to all jobs
    if (employee.accessRole === "manager") {
      const q = query(collection(db, "jobs"), orderBy("createdAt", "desc"));
      const unsub = onSnapshot(
        q,
        (snap) => {
          const list: Job[] = snap.docs.map((d) => ({
            id: d.id,
            ...(d.data() as Omit<Job, "id">),
          }));
          setJobs(list);
          setJobsLoading(false);
        },
        (err) => {
          console.error(err);
          setError(err.message || "Failed to load jobs.");
          setJobs([]);
          setJobsLoading(false);
        }
      );
      return () => unsub();
    }
    // For crew/readOnly: query payouts for this employee and fetch unique jobIds
    const q = query(
      collection(db, "payouts"),
      where("employeeId", "==", employee.id),
      orderBy("createdAt", "desc")
    );
    const unsub = onSnapshot(
      q,
      async (snap) => {
        const payouts: PayoutDoc[] = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<PayoutDoc, "id">),
        }));
        const jobIds = Array.from(
          new Set(
            payouts
              .map((p) => p.jobId)
              .filter((jid): jid is string => typeof jid === "string")
          )
        );
        if (jobIds.length === 0) {
          setJobs([]);
          setJobsLoading(false);
          return;
        }
        try {
          const fetched = await fetchJobsByIds(jobIds);
          setJobs(fetched);
          setJobsLoading(false);
        } catch (e: any) {
          console.error(e);
          setError(e?.message || "Failed to load jobs.");
          setJobs([]);
          setJobsLoading(false);
        }
      },
      (err) => {
        console.error(err);
        setError(err.message || "Failed to load payouts.");
        setJobs([]);
        setJobsLoading(false);
      }
    );
    return () => unsub();
  }, [employee, loading]);

  // Sort jobs by last modified or createdAt descending for consistent order
  const sortedJobs = useMemo(() => {
    return [...jobs].sort((a, b) => {
      const aDate = (a.updatedAt as any) || (a.createdAt as any);
      const bDate = (b.updatedAt as any) || (b.createdAt as any);
      const aTime = aDate?.toMillis?.() || aDate?.getTime?.() || 0;
      const bTime = bDate?.toMillis?.() || bDate?.getTime?.() || 0;
      return bTime - aTime;
    });
  }, [jobs]);

  if (loading || jobsLoading) {
    return <div className="py-10 text-center text-gray-500">Loading jobs…</div>;
  }
  if (error) {
    return <div className="py-10 text-center text-red-600">{error}</div>;
  }
  return (
    <div>
      <h1 className="text-2xl font-semibold mb-4">My Jobs</h1>
      {sortedJobs.length === 0 ? (
        <p className="text-gray-500">No jobs found.</p>
      ) : (
        <ul className="space-y-4">
          {sortedJobs.map((job) => {
            const address = job.address?.fullLine || job.address?.street || "";
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
                    <h2 className="text-lg font-medium text-gray-900">
                      {address || "Unassigned address"}
                    </h2>
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
                {/* Task summary */}
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
      )}
    </div>
  );
}
