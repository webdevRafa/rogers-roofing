import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { db } from "../firebase/firebaseConfig";
import type { Job } from "../types/types";
import { jobConverter } from "../types/types";

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
          <h1 className="text-xl font-semibold text-[var(--color-text)]">
            Punches for {displayDate}
          </h1>
          <p className="text-xs text-[var(--color-muted)]">
            Jobs scheduled to be punched on this day.
          </p>
        </div>
        <div className="flex gap-2">
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
        </div>
      </div>

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
