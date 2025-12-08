import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { useNavigate } from "react-router-dom";
import { db } from "../firebase/firebaseConfig";
import type { Job } from "../types/types";
import { jobConverter } from "../types/types";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Home,
  RotateCcw,
} from "lucide-react";

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

  const days = useMemo(() => getMonthDays(month), [month]);

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const j of jobs) {
      const ms = toMillis((j as any).punchScheduledFor);
      if (!ms) continue;
      const d = new Date(ms);
      const key = toYMD(d);
      map.set(key, (map.get(key) ?? 0) + 1);
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
              Punch Calendar
            </h1>
            <p className="mt-1 text-sm text-white/80">
              See how many jobs are scheduled to be punched each day, then jump
              into a specific date.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
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
              onClick={() => setMonth(new Date())}
              className="inline-flex items-center gap-1 rounded-full border border-white/40 bg-white px-3 py-1.5 text-xs font-semibold text-[var(--color-logo)] shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
            >
              <RotateCcw className="h-4 w-4" />
              Today
            </button>
          </div>
        </div>
      </div>

      {/* Page content */}
      <div className="mx-auto w-[min(1100px,94vw)] space-y-4 py-8">
        {/* Month controls */}
        <section className="rounded-2xl border border-[var(--color-border)]/60 bg-white/90 p-4 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--color-muted)]">
                Month
              </p>
              <h2 className="mt-1 text-lg font-semibold text-[var(--color-text)]">
                {monthLabel}
              </h2>
              <p className="text-xs text-[var(--color-muted)]">
                Use the arrows to move between months or jump back to today.
              </p>
            </div>

            <div className="flex items-center gap-2">
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
              const count = counts.get(key) ?? 0;
              const isToday = toYMD(d) === toYMD(new Date());

              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => navigate(`/punches/${key}`)}
                  className={[
                    "h-20 w-full rounded-xl border px-2 py-1 text-left text-xs transition",
                    count > 0
                      ? "border-[var(--color-border)] bg-emerald-100/30 hover:bg-[var(--color-primary)]/10"
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
                  <div className="mt-2  font-bold text-center text-[var(--color-logo)] rounded-sm text-md  mx-auto py-2">
                    {count === 0 ? "" : count === 1 ? "1 👊" : `${count} 👊`}
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
