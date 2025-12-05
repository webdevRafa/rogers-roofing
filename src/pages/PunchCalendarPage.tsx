import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { useNavigate } from "react-router-dom";
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
    <div className="mx-auto w-[min(900px,94vw)] py-8 pt-24">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-[var(--color-text)]">
            Punch Calendar
          </h1>
          <p className="text-xs text-[var(--color-muted)]">
            View how many jobs are scheduled to be punched each day.
          </p>
        </div>
        <button
          onClick={() => navigate("/jobs")}
          className="text-sm text-blue-600 hover:underline"
        >
          ← Back to Jobs
        </button>
      </div>

      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm">
          <button
            onClick={() => changeMonth(-1)}
            className="rounded-lg border border-[var(--color-border)] bg-white px-2 py-1 text-xs hover:bg-[var(--color-card-hover)]"
          >
            ‹ Prev
          </button>
          <div className="px-3 text-[var(--color-text)] font-medium">
            {monthLabel}
          </div>
          <button
            onClick={() => changeMonth(1)}
            className="rounded-lg border border-[var(--color-border)] bg-white px-2 py-1 text-xs hover:bg-[var(--color-card-hover)]"
          >
            Next ›
          </button>
        </div>
        <button
          onClick={() => setMonth(new Date())}
          className="rounded-lg border border-[var(--color-border)] bg-white px-3 py-1 text-xs text-[var(--color-text)] hover:bg-[var(--color-card-hover)]"
        >
          Today
        </button>
      </div>

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
                "h-20 w-full rounded-lg border px-1 py-1 text-left text-xs transition",
                count > 0
                  ? "border-[var(--color-primary)] bg-[var(--color-card-hover)] hover:bg-[var(--color-primary)]/10"
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
              <div className="mt-2 text-[11px] text-[var(--color-muted)]">
                {count === 0
                  ? "No punches"
                  : count === 1
                  ? "1 punch"
                  : `${count} punches`}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
