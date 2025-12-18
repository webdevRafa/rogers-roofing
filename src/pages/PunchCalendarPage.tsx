import { useEffect, useMemo, useState } from "react";
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { useNavigate } from "react-router-dom";
import { db } from "../firebase/firebaseConfig";
import type { Job } from "../types/types";
import { jobConverter } from "../types/types";
import { ChevronLeft, ChevronRight, RotateCcw } from "lucide-react";
import { useOrg } from "../contexts/OrgContext";

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
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
type DayCounts = {
  felt: number;
  shingles: number;
  punch: number;
};

function makeEmptyDayCounts(): DayCounts {
  return { felt: 0, shingles: 0, punch: 0 };
}

function getMonthStart(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function getMonthEnd(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}
function getMonthDays(base: Date): Date[] {
  const start = getMonthStart(base);
  const end = getMonthEnd(base);
  const out: Date[] = [];
  let cur = new Date(start);
  while (cur <= end) {
    out.push(new Date(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

export default function PunchCalendarPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [month, setMonth] = useState<Date>(new Date());
  const navigate = useNavigate();
  const { orgId, loading } = useOrg();

  useEffect(() => {
    if (loading) return;

    if (!orgId) {
      setJobs([]);
      return;
    }

    const q = query(
      collection(db, "jobs").withConverter(jobConverter),
      where("orgId", "==", orgId),
      orderBy("updatedAt", "desc")
    );

    const unsub = onSnapshot(q, (snap) =>
      setJobs(snap.docs.map((d) => d.data()))
    );
    return () => unsub();
  }, [orgId, loading]);

  const days = useMemo(() => getMonthDays(month), [month]);

  const counts = useMemo(() => {
    const map = new Map<string, DayCounts>();

    const bump = (dateMs: number | null, field: keyof DayCounts) => {
      if (!dateMs) return;
      const d = new Date(dateMs);
      const key = toYMD(d);
      let entry = map.get(key);
      if (!entry) {
        entry = makeEmptyDayCounts();
        map.set(key, entry);
      }
      entry[field] += 1;
    };

    for (const j of jobs) {
      const anyJob = j as any;

      bump(toMillis(anyJob.feltScheduledFor), "felt");
      bump(toMillis(anyJob.shinglesScheduledFor), "shingles");
      bump(toMillis(anyJob.punchScheduledFor), "punch");
    }

    return map;
  }, [jobs]);

  function changeMonth(delta: number) {
    setMonth((prev) => {
      const d = new Date(prev);
      d.setMonth(d.getMonth() + delta);
      return d;
    });
  }

  const monthLabel = month.toLocaleString(undefined, {
    month: "long",
    year: "numeric",
  });

  return (
    <div className="min-h-screen bg-white ">
      {/* Hero / header */}
      <div className="">
        <div className="mx-auto flex max-w-[1100px] flex-col gap-4 p-4 md:flex-row md:items-center md:justify-between md:px-0"></div>
      </div>

      {/* Page content */}
      <div className="mx-auto w-[min(1100px,94vw)] space-y-4 py-0">
        {/* Month controls */}
        <section className="rounded-2xl border border-[var(--color-border)]/60 bg-white/90 p-4 shadow-sm bg-gradient-to-tr from-[var(--color-logo)] via-[var(--color-brown)] to-[var(--color-logo)]">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between ">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-white/80">
                Month
              </p>
              <h2 className="mt-1 text-lg font-semibold text-white">
                {monthLabel}
              </h2>
              <p className="text-xs text-white/60">
                Use the arrows to move between months or jump back to today.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setMonth(new Date())}
                  className="inline-flex items-center gap-1 rounded-full border border-white/40 bg-white/80 px-3 py-1.5 text-xs font-semibold text-[var(--color-logo)] shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                >
                  <RotateCcw className="h-4 w-4" />
                  Today
                </button>
              </div>
              <button
                type="button"
                onClick={() => changeMonth(-1)}
                className="inline-flex items-center justify-center rounded-full border border-[var(--color-border)] bg-white px-2 py-2 text-xs text-[var(--color-text)] shadow-sm transition hover:bg-[var(--color-card-hover)]"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => changeMonth(1)}
                className="inline-flex items-center justify-center rounded-full border border-[var(--color-border)] bg-white px-2 py-2 text-xs text-[var(--color-text)] shadow-sm transition hover:bg-[var(--color-card-hover)]"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </section>

        {/* Calendar grid */}
        <section className="rounded-2xl border border-[var(--color-border)]/60 bg-white/90 p-5 shadow-sm">
          <div className="grid grid-cols-7 gap-1 text-[11px] text-[var(--color-muted)]">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
              <div key={d} className="px-1 py-1 text-center font-medium">
                {d}
              </div>
            ))}
          </div>

          <div className="mt-1 grid grid-cols-7 gap-1">
            {/* leading blanks */}
            {(() => {
              const first = getMonthStart(month);
              const blanks = first.getDay();
              return Array.from({ length: blanks }).map((_, i) => (
                <div key={`blank-${i}`} />
              ));
            })()}

            {days.map((d) => {
              const key = toYMD(d);
              const dayCounts = counts.get(key) ?? makeEmptyDayCounts();
              const isToday = toYMD(d) === toYMD(new Date());

              const hasAnything =
                dayCounts.felt + dayCounts.shingles + dayCounts.punch > 0;

              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => navigate(`/schedule/${key}`)}
                  className={[
                    "h-20 w-full rounded-xl border px-2 py-1 text-left text-xs transition",
                    hasAnything
                      ? "border-[var(--color-border)] bg-emerald-50/40 hover:bg-[var(--color-primary)]/10"
                      : "border-[var(--color-border)] bg-white hover:bg-[var(--color-card-hover)]",
                    isToday ? "ring-2 ring-[var(--color-accent)]" : "",
                  ].join(" ")}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[var(--color-text)] font-semibold">
                      {d.getDate()}
                    </span>
                    {isToday && (
                      <span className="rounded-full bg-[var(--color-accent)]/20 px-1.5 py-0.5 text-[9px] uppercase text-[var(--color-text)]">
                        Today
                      </span>
                    )}
                  </div>

                  {hasAnything && (
                    <>
                      {/* Mobile: compact color-only badges with counts (no text labels) */}
                      <div className="mt-2 flex items-center justify-center gap-0 text-[11px] font-semibold md:hidden">
                        {dayCounts.felt > 0 && (
                          <span
                            className="inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-sky-100 text-[10px] font-semibold text-sky-800"
                            aria-label={`${dayCounts.felt} felt`}
                          >
                            {dayCounts.felt}
                          </span>
                        )}
                        {dayCounts.shingles > 0 && (
                          <span
                            className="inline-flex h-4 min-w-[1.25rem] items-center justify-center rounded-full bg-amber-100 text-[10px] font-semibold text-amber-800"
                            aria-label={`${dayCounts.shingles} shingles`}
                          >
                            {dayCounts.shingles}
                          </span>
                        )}
                        {dayCounts.punch > 0 && (
                          <span
                            className="inline-flex h-4 min-w-[1.25rem] items-center justify-center rounded-full bg-emerald-100 text-[10px] font-semibold text-emerald-800"
                            aria-label={`${dayCounts.punch} punches`}
                          >
                            {dayCounts.punch}
                          </span>
                        )}
                      </div>

                      {/* md+ : keep the full pills with text labels */}
                      <div className="mt-0 hidden  justify-center md:items-end lg:items-center md:mt-[-6px] lg:mt-[-10px] gap-1 text-[8px] font-semibold md:flex flex-col ">
                        {dayCounts.felt > 0 && (
                          <span className="inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-sky-800">
                            {dayCounts.felt} DRY
                          </span>
                        )}
                        {dayCounts.shingles > 0 && (
                          <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-amber-800">
                            {dayCounts.shingles} SHINGLES
                          </span>
                        )}
                        {dayCounts.punch > 0 && (
                          <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-emerald-800">
                            {dayCounts.punch} PUNCH
                          </span>
                        )}
                      </div>
                    </>
                  )}
                </button>
              );
            })}
          </div>
          {/* Mobile legend for colors */}
          <div className="mt-4 flex items-center justify-center gap-4 text-[11px] text-[var(--color-muted)] md:hidden">
            <div className="flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-full bg-sky-200" />
              <span>Felt</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-full bg-amber-200" />
              <span>Shingles</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-200" />
              <span>Punch</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
