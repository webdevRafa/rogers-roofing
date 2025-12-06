import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import type { FieldValue } from "firebase/firestore";
import { db } from "../firebase/firebaseConfig";
import type { Job } from "../types/types";
import { jobConverter } from "../types/types";
import { recomputeJob, makeAddress } from "../utils/calc";

type FsTimestampLike = { toDate: () => Date };
function isFsTimestamp(x: unknown): x is FsTimestampLike {
  return typeof (x as FsTimestampLike)?.toDate === "function";
}
function toMillis(x: unknown): number | null {
  if (x == null) return null;
  if (isFsTimestamp(x)) return x.toDate().getTime();
  if (x instanceof Date) return x.getTime();
  if (typeof x === "string" || typeof x === "number") {
    const d = new Date(x);
    return Number.isNaN(d.getTime()) ? null : d.getTime();
  }
  return null;
}
function toYMD(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addr(a: Job["address"] | null | undefined) {
  if (typeof a === "string")
    return { display: a, line1: a, city: "", state: "", zip: "" };

  const obj: Record<string, unknown> =
    (a as unknown as Record<string, unknown>) ?? {};
  const pick = (keys: string[]) => {
    for (const k of keys) {
      const v = obj[k];
      if (typeof v === "string" && v.trim().length > 0) return v;
    }
    return "";
  };

  const line1 = pick([
    "fullLine",
    "line1",
    "street",
    "address1",
    "address",
    "formatted",
    "text",
    "label",
    "street1",
  ]);
  const city = pick(["city", "town"]);
  const state = pick(["state", "region", "province"]);
  const zip = pick(["zip", "postalCode", "postcode", "zipCode"]);
  const display =
    pick(["fullLine", "full", "formatted", "label", "text"]) || line1;

  return { display, line1, city, state, zip };
}

export default function PunchDayPage() {
  const { date } = useParams<{ date: string }>();
  const navigate = useNavigate();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [openForm, setOpenForm] = useState(false);
  const [address, setAddress] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const q = query(
      collection(db, "jobs").withConverter(jobConverter),
      orderBy("updatedAt", "desc")
    );
    const unsub = onSnapshot(q, (snap) =>
      setJobs(snap.docs.map((d) => d.data()))
    );
    return () => unsub();
  }, []);
  async function createJobForDay() {
    if (!date) return;

    setCreating(true);
    setError(null);

    try {
      if (!address.trim()) {
        throw new Error("Please enter a job address.");
      }

      const newRef = doc(collection(db, "jobs"));
      const scheduledDate = new Date(date + "T00:00:00");

      let job: Job = {
        id: newRef.id,
        status: "pending",
        address: makeAddress(address),
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
        punchScheduledFor: scheduledDate,
        createdAt: serverTimestamp() as FieldValue,
        updatedAt: serverTimestamp() as FieldValue,
        computed: {
          totalExpensesCents: 0,
          netProfitCents: 0,
        },
      };

      // Keep computed fields in sync (same as JobsPage)
      job = recomputeJob(job);

      // Write using the same converter as elsewhere
      await setDoc(newRef.withConverter(jobConverter), job);

      // Go straight to JobDetailPage for this job
      navigate(`/job/${newRef.id}`);

      // Reset form state in case user comes back
      setAddress("");
      setOpenForm(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }

  const jobsForDay = useMemo(() => {
    if (!date) return [];
    return jobs.filter((j) => {
      const ms = toMillis((j as any).punchScheduledFor);
      if (!ms) return false;
      const d = new Date(ms);
      return toYMD(d) === date;
    });
  }, [jobs, date]);

  const displayDate = date
    ? new Date(date + "T00:00:00").toLocaleDateString()
    : "Unknown date";

  return (
    <div className="mx-auto w-[min(900px,94vw)] py-8 pt-24">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold font-poppins text-[var(--color-text)]">
            Punches for {displayDate}
          </h1>
          <p className="text-xs text-[var(--color-muted)]">
            Jobs scheduled to be punched on this day.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => navigate("/punches")}
            className="text-sm text-blue-600 hover:underline"
          >
            ← Back to calendar
          </button>
          <button
            onClick={() => navigate("/jobs")}
            className="text-sm text-blue-600 hover:underline"
          >
            Jobs
          </button>
          <button
            onClick={() => setOpenForm((v) => !v)}
            className="rounded-lg bg-cyan-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-cyan-700 transition duration-300 ease-in-out"
          >
            + New job for this day
          </button>
        </div>
      </div>
      {openForm && (
        <div className="mb-4 rounded-xl bg-[var(--color-card)] p-4 shadow">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Job address (e.g., 123 Main St, San Antonio, TX)"
              className="w-full rounded-lg border border-[var(--color-border)] bg-white/80 px-3 py-2 text-sm text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
            />
            <button
              onClick={createJobForDay}
              disabled={creating}
              className="rounded-lg bg-cyan-800 px-4 py-2 text-sm text-white hover:bg-cyan-700 disabled:opacity-60 transition duration-300 ease-in-out"
            >
              {creating ? "Saving…" : "Create"}
            </button>
          </div>

          {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

          {date && (
            <p className="mt-2 text-[11px] text-[var(--color-muted)]">
              This job will be scheduled to punch on{" "}
              {new Date(date + "T00:00:00").toLocaleDateString()}.
            </p>
          )}
        </div>
      )}

      {jobsForDay.length === 0 ? (
        <p className="text-sm text-[var(--color-muted)]">
          No jobs are scheduled to be punched on this day.
        </p>
      ) : (
        <ul className="space-y-2">
          {jobsForDay.map((j) => {
            const a = addr(j.address);
            return (
              <li
                key={j.id}
                className="flex items-center justify-between rounded-xl border border-[var(--color-border)] bg-white/80 px-3 py-2 text-sm"
              >
                <div>
                  <div className="font-medium text-[var(--color-text)]">
                    {a.display || "—"}
                  </div>
                  {(a.city || a.state || a.zip) && (
                    <div className="text-xs text-[var(--color-muted)]">
                      {[a.city, a.state, a.zip].filter(Boolean).join(", ")}
                    </div>
                  )}
                  <div className="mt-1 text-[10px] uppercase tracking-wide text-[var(--color-muted)]">
                    Status: {j.status}
                  </div>
                </div>
                <Link
                  to={`/job/${j.id}`}
                  className="rounded-lg border border-[var(--color-border)] px-3 py-1 text-xs text-[var(--color-text)] hover:bg-[var(--color-card-hover)]"
                >
                  View job
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
