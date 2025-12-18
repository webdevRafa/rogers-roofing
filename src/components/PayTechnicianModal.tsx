import { createPortal } from "react-dom";
import { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";
import type { FieldValue } from "firebase/firestore";
import { X, Wrench } from "lucide-react";

import { db } from "../firebase/firebaseConfig";
import type { Employee, PayoutDoc } from "../types/types";
import { useOrg } from "../contexts/OrgContext";

/**
 * PayTechnicianModal
 * - Creates a GLOBAL payout doc (no job association) in `payouts`
 * - category: "technician"
 * - amountCents derived from daysWorked * ratePerDayCents
 *
 * Usage:
 * {techPayOpen && (
 *   <PayTechnicianModal
 *     onClose={() => setTechPayOpen(false)}
 *     defaultEmployeeId={employee?.id}
 *     lockEmployee={true}
 *     onCreated={() => toast("Technician payout created")}
 *   />
 * )}
 */

export type PayTechnicianModalProps = {
  onClose: () => void;

  /** Optional: preselect an employee (useful on EmployeeDetailPage) */
  defaultEmployeeId?: string;

  /** If true, employee select is disabled (useful when launching from an employee page) */
  lockEmployee?: boolean;

  /** Optional callback after successful creation */
  onCreated?: (created: PayoutDoc) => void;

  /** Optional: default day rate (USD) */
  defaultRatePerDay?: number;

  /** Optional: default method */
  defaultMethod?: "cash" | "check" | "zelle" | "other";
};

function money(cents: number | null | undefined): string {
  const v = typeof cents === "number" ? cents : 0;
  return (v / 100).toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
  });
}

function toCents(x: number): number {
  return Math.round(x * 100);
}

export default function PayTechnicianModal({
  onClose,
  defaultEmployeeId,
  lockEmployee,
  onCreated,
  defaultRatePerDay,
  defaultMethod = "check",
}: PayTechnicianModalProps) {
  if (typeof document === "undefined") return null;

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loadingEmployees, setLoadingEmployees] = useState(true);
  const [employeesError, setEmployeesError] = useState<string | null>(null);

  const [employeeId, setEmployeeId] = useState(defaultEmployeeId ?? "");
  const [daysWorked, setDaysWorked] = useState<string>("");
  const [ratePerDay, setRatePerDay] = useState<string>(
    typeof defaultRatePerDay === "number" ? String(defaultRatePerDay) : ""
  );
  const [method, setMethod] = useState<"cash" | "check" | "zelle" | "other">(
    defaultMethod
  );
  const [note, setNote] = useState<string>("");

  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const { orgId } = useOrg();

  // Load active employees (fallback to all if isActive missing)
  useEffect(() => {
    (async () => {
      if (!orgId) {
        setEmployees([]);
        setLoadingEmployees(false);
        return;
      }

      try {
        setLoadingEmployees(true);
        setEmployeesError(null);

        const ref = collection(db, "employees");

        // Try to fetch active employees first
        const qActive = query(
          ref,
          where("orgId", "==", orgId),
          where("isActive", "==", true),
          orderBy("name"),
          limit(200)
        );
        const activeSnap = await getDocs(qActive);

        let list: Employee[] = activeSnap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<Employee, "id">),
        }));

        // If none found (or field missing across docs), fallback to all employees
        if (list.length === 0) {
          const qAll = query(
            ref,
            where("orgId", "==", orgId),
            orderBy("name"),
            limit(200)
          );
          const allSnap = await getDocs(qAll);
          list = allSnap.docs.map((d) => ({
            id: d.id,
            ...(d.data() as Omit<Employee, "id">),
          }));
        }

        setEmployees(list);

        // If no preselected employee, default to first
        if (!defaultEmployeeId && list.length > 0) {
          setEmployeeId((prev) => prev || list[0].id);
        }
      } catch (e) {
        setEmployeesError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoadingEmployees(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  const selectedEmployee = useMemo(
    () => employees.find((e) => e.id === employeeId) ?? null,
    [employees, employeeId]
  );

  const daysNum = useMemo(() => Number(daysWorked), [daysWorked]);
  const rateNum = useMemo(() => Number(ratePerDay), [ratePerDay]);

  const totalCents = useMemo(() => {
    if (!Number.isFinite(daysNum) || !Number.isFinite(rateNum)) return 0;
    if (daysNum <= 0 || rateNum <= 0) return 0;
    return Math.round(daysNum * toCents(rateNum));
  }, [daysNum, rateNum]);

  async function submit() {
    setFormError(null);

    if (!employeeId) {
      setFormError("Please select an employee.");
      return;
    }
    if (!selectedEmployee) {
      setFormError("Selected employee not found.");
      return;
    }
    if (!Number.isFinite(daysNum) || daysNum <= 0) {
      setFormError("Enter days worked (must be greater than 0).");
      return;
    }
    if (!Number.isFinite(rateNum) || rateNum <= 0) {
      setFormError("Enter rate per day (must be greater than 0).");
      return;
    }
    if (!orgId) {
      setFormError("Org not loaded. Please refresh and try again.");
      return;
    }

    const ratePerDayCents = toCents(rateNum);
    const amountCents = Math.round(daysNum * ratePerDayCents);

    setSaving(true);
    try {
      const payoutRef = doc(collection(db, "payouts"));

      // NOTE: keep the doc minimal + compatible with your existing dashboard renders
      const docData: Omit<PayoutDoc, "id"> & {
        memo?: string;
      } = {
        orgId,
        employeeId,
        employeeNameSnapshot: selectedEmployee.name,

        category: "technician",
        amountCents,

        // breakdown fields
        daysWorked: daysNum,
        ratePerDayCents,

        method,

        ...(note.trim().length ? { memo: note.trim() } : {}),

        createdAt: serverTimestamp() as unknown as FieldValue,

        // unpaid by default
        paidAt: null as any,
      };

      await setDoc(payoutRef, docData as any);

      const created: PayoutDoc = {
        id: payoutRef.id,
        ...(docData as any),
      };

      onCreated?.(created);
      onClose();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  // Close on ESC
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const content = (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 p-3">
      {/* Click-away overlay */}
      <button
        type="button"
        onClick={onClose}
        className="absolute inset-0 cursor-default"
        aria-label="Close"
      />

      <div className="relative w-full max-w-xl rounded-2xl bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-gray-100 px-6 py-5">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-[var(--color-primary)]/10 text-[var(--color-primary)]">
              <Wrench className="h-5 w-5" />
            </div>

            <div>
              <h2 className="text-xl font-semibold text-[var(--color-text)]">
                Pay technician
              </h2>
              <p className="mt-1 text-xs text-[var(--color-muted)]">
                Create a global technician payout (not tied to any job).
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-gray-300 px-2 py-1 text-[11px] text-gray-600 hover:bg-gray-100"
          >
            <span className="sr-only">Close</span>
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5">
          {employeesError && (
            <div className="mb-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {employeesError}
            </div>
          )}

          {formError && (
            <div className="mb-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {formError}
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            {/* Employee select */}
            <div className="sm:col-span-2">
              <label className="text-[10px] uppercase tracking-wide text-gray-500">
                Employee
              </label>

              <select
                value={employeeId}
                onChange={(e) => setEmployeeId(e.target.value)}
                disabled={lockEmployee || loadingEmployees || saving}
                className="mt-1 w-full rounded-xl border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-accent)] disabled:opacity-60"
              >
                {loadingEmployees && <option>Loading employees…</option>}
                {!loadingEmployees && employees.length === 0 && (
                  <option value="">No employees found</option>
                )}
                {!loadingEmployees &&
                  employees.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                      {e.isActive === false ? " (inactive)" : ""}
                    </option>
                  ))}
              </select>

              <p className="mt-1 text-[11px] text-gray-500">
                Tip: launch this from an employee page to lock the selection.
              </p>
            </div>

            {/* Days worked */}
            <div>
              <label className="text-[10px] uppercase tracking-wide text-gray-500">
                Days worked
              </label>
              <input
                value={daysWorked}
                onChange={(e) => setDaysWorked(e.target.value)}
                type="number"
                min={0}
                step="1"
                placeholder="e.g. 3"
                disabled={saving}
                className="mt-1 w-full rounded-xl border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-accent)] disabled:opacity-60"
              />
            </div>

            {/* Rate per day */}
            <div>
              <label className="text-[10px] uppercase tracking-wide text-gray-500">
                Rate per day ($)
              </label>
              <input
                value={ratePerDay}
                onChange={(e) => setRatePerDay(e.target.value)}
                type="number"
                min={0}
                step="0.01"
                placeholder="e.g. 250"
                disabled={saving}
                className="mt-1 w-full rounded-xl border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-accent)] disabled:opacity-60"
              />
            </div>

            {/* Method */}
            <div>
              <label className="text-[10px] uppercase tracking-wide text-gray-500">
                Method
              </label>
              <select
                value={method}
                onChange={(e) =>
                  setMethod(
                    e.target.value as "cash" | "check" | "zelle" | "other"
                  )
                }
                disabled={saving}
                className="mt-1 w-full rounded-xl border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-accent)] disabled:opacity-60"
              >
                <option value="check">Check</option>
                <option value="cash">Cash</option>
                <option value="zelle">Zelle</option>
                <option value="other">Other</option>
              </select>
            </div>

            {/* Total preview */}
            <div className="flex items-end">
              <div className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-2">
                <div className="text-[10px] uppercase tracking-wide text-[var(--color-muted)]">
                  Total
                </div>
                <div className="mt-1 text-lg font-semibold text-[var(--color-text)]">
                  {money(totalCents)}
                </div>

                {totalCents > 0 && (
                  <div className="mt-0.5 text-[11px] text-[var(--color-muted)]">
                    {daysNum} day{daysNum === 1 ? "" : "s"} @{" "}
                    {(toCents(rateNum) / 100).toLocaleString(undefined, {
                      style: "currency",
                      currency: "USD",
                    })}
                    /day
                  </div>
                )}
              </div>
            </div>

            {/* Note */}
            <div className="sm:col-span-2">
              <label className="text-[10px] uppercase tracking-wide text-gray-500">
                Note (optional)
              </label>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. Week of Dec 9–13"
                disabled={saving}
                rows={2}
                className="mt-1 w-full resize-none rounded-xl border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-accent)] disabled:opacity-60"
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex flex-col-reverse gap-2 border-t border-gray-100 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-60"
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={submit}
            disabled={saving || totalCents <= 0 || !employeeId}
            className="rounded-lg bg-emerald-800 hover:bg-emerald-700 transition duration-300 ease-in-out px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {saving ? "Creating…" : "Create technician payout"}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
