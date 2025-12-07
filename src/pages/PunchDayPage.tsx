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
import { ArrowLeft, CalendarDays, Home, PlusCircle } from "lucide-react";

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
function money(cents: number | null | undefined): string {
  const v = typeof cents === "number" ? cents : 0;
  return (v / 100).toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
  });
}

function statusPillClasses(status: Job["status"]) {
  switch (status) {
    case "completed":
    case "paid":
      return "bg-emerald-50 text-emerald-700";
    case "active":
      return "bg-[var(--color-primary)]/10 text-[var(--color-primary)]";
    case "pending":
      return "bg-yellow-50 text-yellow-800";
    case "invoiced":
      return "bg-blue-50 text-blue-700";
    case "closed":
    case "archived":
      return "bg-gray-100 text-gray-700";
    default:
      return "bg-neutral-100 text-neutral-700";
  }
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
    <div className="min-h-screen bg-gradient-to-b from-slate-50 via-slate-50 to-slate-100">
      {/* Hero / header */}
      <div className="bg-gradient-to-tr from-[var(--color-logo)] via-[var(--color-brown)] to-[var(--color-logo)]">
        <div className="mx-auto flex max-w-[1100px] flex-col gap-4 px-4 py-10 md:flex-row md:items-center md:justify-between md:px-0">
          <div>
            <p className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.18em] text-white/70">
              <CalendarDays className="h-4 w-4" />
              <span>Punch schedule</span>
            </p>
            <h1 className="mt-2 text-2xl font-semibold text-white md:text-3xl">
              Punches for {displayDate}
            </h1>
            <p className="mt-1 text-sm text-white/80">
              Jobs scheduled to be punched on this day.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => navigate("/punches")}
              className="inline-flex items-center gap-1 rounded-full border border-white/40 bg-white/10 px-3 py-1.5 text-xs font-medium text-white backdrop-blur-sm transition hover:bg-white/20"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to calendar
            </button>

            <button
              type="button"
              onClick={() => navigate("/jobs")}
              className="inline-flex items-center gap-1 rounded-full border border-white/30 bg-white/10 px-3 py-1.5 text-xs font-medium text-white backdrop-blur-sm transition hover:bg-white/20"
            >
              <Home className="h-4 w-4" />
              Jobs overview
            </button>

            <button
              type="button"
              onClick={() => setOpenForm((v) => !v)}
              className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-1.5 text-xs font-semibold text-[var(--color-logo)] shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
            >
              <PlusCircle className="h-4 w-4" />
              {openForm ? "Close job form" : "New job for this day"}
            </button>
          </div>
        </div>
      </div>

      {/* Page content */}
      <div className="mx-auto w-[min(1100px,94vw)] space-y-6 py-8">
        {/* Create job form */}
        {openForm && (
          <section className="rounded-2xl border border-[var(--color-border)]/60 bg-white/90 p-4 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div className="flex-1">
                <h2 className="text-sm font-semibold text-[var(--color-text)]">
                  Schedule a new job for this day
                </h2>
                <p className="mt-1 text-xs text-[var(--color-muted)]">
                  Create a job already tagged to this punch date. You can add
                  details and payouts on the job detail page.
                </p>

                <input
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Job address (e.g., 123 Main St, San Antonio, TX)"
                  className="mt-3 w-full rounded-lg border border-[var(--color-border)]/70 bg-white px-3 py-2 text-sm text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                />
              </div>

              <div className="flex w-full flex-col gap-2 sm:w-auto sm:items-end">
                <button
                  type="button"
                  onClick={createJobForDay}
                  disabled={creating || !address.trim()}
                  className="inline-flex items-center justify-center rounded-lg bg-[var(--color-logo)] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-cyan-900 disabled:opacity-60"
                >
                  {creating ? "Creating…" : "Create job"}
                </button>

                {date && (
                  <p className="text-[11px] text-[var(--color-muted)]">
                    This job will be scheduled to punch on{" "}
                    {new Date(date + "T00:00:00").toLocaleDateString()}.
                  </p>
                )}
              </div>
            </div>

            {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
          </section>
        )}

        {/* Scheduled jobs */}
        <section className="rounded-2xl border border-[var(--color-border)]/60 bg-white/90 p-5 shadow-sm">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-semibold text-[var(--color-text)]">
                Scheduled punches
              </h2>
              <p className="text-xs text-[var(--color-muted)]">
                {jobsForDay.length === 0
                  ? "No jobs are currently queued to be punched on this date."
                  : "Review the jobs queued for this punch date and jump into their details."}
              </p>
            </div>

            {jobsForDay.length > 0 && (
              <div className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-medium text-slate-700">
                {jobsForDay.length} job
                {jobsForDay.length === 1 ? "" : "s"} scheduled
              </div>
            )}
          </div>

          {jobsForDay.length === 0 ? (
            <div className="mt-6 flex flex-col items-center justify-center gap-3 py-10 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-logo)]/10">
                <CalendarDays className="h-6 w-6 text-[var(--color-logo)]" />
              </div>
              <h3 className="text-sm font-semibold text-[var(--color-text)]">
                No punches scheduled for this day
              </h3>
              <p className="max-w-md text-sm text-[var(--color-muted)]">
                When you schedule jobs to punch on this date, they will appear
                here. Use the{" "}
                <span className="font-semibold">“New job for this day”</span>{" "}
                button above to get started.
              </p>
              {!openForm && (
                <button
                  type="button"
                  onClick={() => setOpenForm(true)}
                  className="mt-2 inline-flex items-center gap-2 rounded-full bg-[var(--color-logo)] px-4 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-cyan-900"
                >
                  <PlusCircle className="h-4 w-4" />
                  Create job for {displayDate}
                </button>
              )}
            </div>
          ) : (
            <ul className="mt-4 space-y-3">
              {jobsForDay.map((j) => {
                const a = addr(j.address);
                const ms = toMillis((j as any).punchScheduledFor);
                const punchTime =
                  ms != null
                    ? new Date(ms).toLocaleTimeString([], {
                        hour: "numeric",
                        minute: "2-digit",
                      })
                    : null;

                return (
                  <li
                    key={j.id}
                    className="group flex items-start justify-between gap-4 rounded-2xl border border-[var(--color-border)]/60 bg-white/80 px-4 py-3 text-sm shadow-sm transition hover:-translate-y-0.5 hover:border-[var(--color-accent)]/80 hover:shadow-md"
                  >
                    <div className="flex flex-1 gap-3">
                      <div className="mt-1 flex h-9 w-9 items-center justify-center rounded-full bg-[var(--color-card)] text-[var(--color-logo)]">
                        <Home className="h-4 w-4" />
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-[var(--color-text)]">
                          {a.display || "—"}
                        </div>
                        {(a.city || a.state || a.zip) && (
                          <div className="text-[11px] text-[var(--color-muted)]">
                            {[a.city, a.state, a.zip]
                              .filter(Boolean)
                              .join(", ")}
                          </div>
                        )}
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-[var(--color-muted)]">
                          <span
                            className={
                              "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase " +
                              statusPillClasses(j.status)
                            }
                          >
                            {j.status}
                          </span>
                          <span className="rounded-full bg-slate-50 px-2 py-0.5">
                            Punch date: {displayDate}
                            {punchTime ? ` • ${punchTime}` : ""}
                          </span>
                          <span className="rounded-full bg-slate-50 px-2 py-0.5">
                            Created{" "}
                            {j.createdAt &&
                              new Date(
                                toMillis(j.createdAt as unknown) ?? 0
                              ).toLocaleDateString()}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-col items-end gap-2">
                      <div className="text-right">
                        <div className="text-[11px] text-[var(--color-muted)]">
                          Job total
                        </div>
                        <div className="text-sm font-semibold text-[var(--color-text)]">
                          {money(j.earnings?.totalEarningsCents)}
                        </div>
                      </div>

                      <Link
                        to={`/job/${j.id}`}
                        className="inline-flex items-center gap-1 rounded-full border border-[var(--color-border)] px-3 py-1.5 text-[11px] font-medium text-[var(--color-text)] transition hover:bg-[var(--color-card-hover)]"
                      >
                        View job
                      </Link>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
