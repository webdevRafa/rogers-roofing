// src/pages/EmployeeDetailPage.tsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";
import type { FieldValue } from "firebase/firestore";
import { db } from "../firebase/firebaseConfig";
import type {
  Employee,
  EmployeeAddress,
  PayoutDoc,
  PayoutStubDoc,
  PayoutStubLine,
} from "../types/types";
import { ChevronDown, ChevronLeft } from "lucide-react";
import { GlobalPayoutStubModal } from "../components/GlobalPayoutStubModal";
import { PayoutStubViewerModal } from "../components/PayoutStubViewerModal";

// ---------- Small helpers ----------

function money(cents: number | undefined | null): string {
  const v = typeof cents === "number" ? cents : 0;
  return (v / 100).toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
  });
}

type AnyAddress = unknown;

function pickString(obj: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim().length > 0) return v;
  }
  return "";
}

function normalizeJobAddress(a: AnyAddress) {
  if (typeof a === "string") {
    return {
      display: a,
      line1: a,
      city: "",
      state: "",
      zip: "",
    };
  }

  const obj: Record<string, unknown> = (a ?? {}) as Record<string, unknown>;
  const line1 = pickString(obj, [
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
  const city = pickString(obj, ["city", "town"]);
  const state = pickString(obj, ["state", "region", "province"]);
  const zip = pickString(obj, ["zip", "postalCode", "postcode", "zipCode"]);
  const display =
    pickString(obj, ["fullLine", "full", "formatted", "label", "text"]) ||
    line1;

  return { display, line1, city, state, zip };
}

type FsTimestampLike = { toDate: () => Date };
function isFsTimestamp(x: unknown): x is FsTimestampLike {
  return typeof (x as FsTimestampLike)?.toDate === "function";
}
function fmtDate(x: unknown): string {
  if (x == null) return "—";
  if (isFsTimestamp(x)) return x.toDate().toLocaleString();
  if (x instanceof Date) return x.toLocaleString();
  if (typeof x === "string" || typeof x === "number") {
    const d = new Date(x);
    return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
  }
  return "—";
}

type PayoutFilter = "all" | "pending" | "paid";

export default function EmployeeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [employee, setEmployee] = useState<Employee | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [address, setAddress] = useState<EmployeeAddress>({
    fullLine: "",
    line1: "",
    city: "",
    state: "",
    zip: "",
  });
  const [isActive, setIsActive] = useState(true);
  const [profileOpen, setProfileOpen] = useState(false);
  const [payoutsOpen, setPayoutsOpen] = useState(true);

  // ---- Payouts state ----
  const [payouts, setPayouts] = useState<PayoutDoc[]>([]);
  const [payoutsLoading, setPayoutsLoading] = useState(true);
  const [payoutsError, setPayoutsError] = useState<string | null>(null);
  const [payoutFilter, setPayoutFilter] = useState<PayoutFilter>("pending");
  const [searchTerm, setSearchTerm] = useState("");

  // For "Create stub" flow
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [stubOpen, setStubOpen] = useState(false);
  const [stubSaving, setStubSaving] = useState(false);

  const [stubs, setStubs] = useState<PayoutStubDoc[]>([]);
  const [stubsLoading, setStubsLoading] = useState(true);
  const [stubsError, setStubsError] = useState<string | null>(null);
  const [stubSearch, setStubSearch] = useState("");
  const [viewStubId, setViewStubId] = useState<string | null>(null);

  // ---------- Load employee ----------
  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        const ref = doc(collection(db, "employees"), id);
        const snap = await getDoc(ref);
        if (!snap.exists()) throw new Error("Employee not found");
        const data = snap.data() as Employee;

        setEmployee(data);
        setName(data.name);
        setIsActive(data.isActive !== false); // default to active when missing

        const addr = normalizeEmployeeAddress(data.address);
        setAddress({
          fullLine: addr?.fullLine ?? "",
          line1: addr?.line1 ?? "",
          city: addr?.city ?? "",
          state: addr?.state ?? "",
          zip: addr?.zip ?? "",
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [id]);

  // ---------- Live payouts for this employee ----------
  useEffect(() => {
    if (!id) return;
    const ref = collection(db, "payouts");
    const q = query(
      ref,
      where("employeeId", "==", id),
      orderBy("createdAt", "desc")
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: PayoutDoc[] = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<PayoutDoc, "id">),
        }));

        setPayouts(list);
        setPayoutsLoading(false);
        setPayoutsError(null);
      },
      (err) => {
        console.error(err);
        setPayoutsError(err.message || String(err));
        setPayoutsLoading(false);
      }
    );

    return () => unsub();
  }, [id]);

  // Clear selection when leaving "pending" tab
  useEffect(() => {
    if (payoutFilter !== "pending") {
      setSelectedIds([]);
    }
  }, [payoutFilter]);

  async function save() {
    if (!employee) return;
    setSaving(true);
    setError(null);

    try {
      const ref = doc(collection(db, "employees"), employee.id);
      const next: Employee = {
        ...employee,
        name: name.trim(),
        address,
        isActive,
        updatedAt: serverTimestamp() as FieldValue,
      };

      await setDoc(ref, next, { merge: true });

      navigate("/employees", {
        replace: true,
        state: { message: "Employee details saved successfully." },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }
  // subscribe to payoutStubs for this employee
  useEffect(() => {
    if (!id) return;

    const ref = collection(db, "payoutStubs");
    const q = query(
      ref,
      where("employeeId", "==", id),
      orderBy("createdAt", "desc")
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: PayoutStubDoc[] = snap.docs.map((d) => ({
          ...(d.data() as PayoutStubDoc),
          id: d.id, // ensure id is correct even if not stored in data
        }));

        setStubs(list);
        setStubsLoading(false);
        setStubsError(null);
      },
      (err) => {
        console.error(err);
        setStubsError(err.message || String(err));
        setStubsLoading(false);
      }
    );

    return () => unsub();
  }, [id]);

  // ---- Filtered payouts (by tab + search) ----
  const filteredPayouts = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();

    return payouts.filter((p) => {
      if (payoutFilter === "pending" && p.paidAt) return false;
      if (payoutFilter === "paid" && !p.paidAt) return false;

      if (term.length > 0) {
        const a = normalizeJobAddress(p.jobAddressSnapshot);
        const haystack = [a.display, a.line1, a.city, a.state, a.zip]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        if (!haystack.includes(term)) return false;
      }

      return true;
    });
  }, [payouts, payoutFilter, searchTerm]);

  // filtered list for stub seaarch (address + stub number)
  const filteredStubs = useMemo(() => {
    const term = stubSearch.trim().toLowerCase();
    if (!term) return stubs;

    return stubs.filter((s) => {
      const number = s.number?.toLowerCase() ?? "";
      const employeeName = s.employeeNameSnapshot?.toLowerCase() ?? "";
      const addrHaystack = (s.lines ?? [])
        .map((l) => {
          const a = l.jobAddressSnapshot;
          return [a?.fullLine, a?.line1, a?.city, a?.state, a?.zip]
            .filter(Boolean)
            .join(" ");
        })
        .join(" ")
        .toLowerCase();

      return (
        number.includes(term) ||
        employeeName.includes(term) ||
        addrHaystack.includes(term)
      );
    });
  }, [stubs, stubSearch]);

  const stubToView = useMemo(() => {
    if (!viewStubId) return null;
    return stubs.find((s) => s.id === viewStubId) ?? null;
  }, [stubs, viewStubId]);

  const selectedPayouts = useMemo(
    () => payouts.filter((p) => selectedIds.includes(p.id)),
    [payouts, selectedIds]
  );

  async function markSelectedAsPaid() {
    if (!employee) return;

    const payoutsToMark = selectedPayouts.filter((p) => !p.paidAt);
    if (payoutsToMark.length === 0) {
      setStubOpen(false);
      return;
    }

    setStubSaving(true);

    try {
      // 1) Create stub doc
      const stubRef = doc(collection(db, "payoutStubs"));
      const now = new Date();

      // Simple, stable stub number (no extra counters needed)
      const y = now.getFullYear();
      const mm = String(now.getMonth() + 1).padStart(2, "0");
      const dd = String(now.getDate()).padStart(2, "0");
      const shortId = stubRef.id.slice(0, 6).toUpperCase();
      const number = `STUB-${y}${mm}${dd}-${shortId}`;

      const lines: PayoutStubLine[] = payoutsToMark.map((p) => ({
        payoutId: p.id,
        jobId: p.jobId ?? undefined,
        category: p.category,
        sqft: p.sqft,
        ratePerSqFt: p.ratePerSqFt,
        amountCents: typeof p.amountCents === "number" ? p.amountCents : 0,
        jobAddressSnapshot: p.jobAddressSnapshot ?? undefined,
      }));

      const totalCents = lines.reduce(
        (sum, l) => sum + (l.amountCents || 0),
        0
      );

      const jobIds = Array.from(
        new Set(lines.map((l) => l.jobId).filter(Boolean) as string[])
      );

      const employeeAddr =
        normalizeEmployeeAddress(employee.address) ?? undefined;

      const stubDoc: PayoutStubDoc = {
        id: stubRef.id,
        number,
        employeeId: employee.id,
        employeeNameSnapshot: employee.name,
        employeeAddressSnapshot: employeeAddr,
        payoutIds: lines.map((l) => l.payoutId),
        jobIds,
        lines,
        totalCents,
        createdAt: serverTimestamp() as unknown as FieldValue,
        paidAt: serverTimestamp() as unknown as FieldValue,
        status: "paid",
      };

      await setDoc(stubRef, stubDoc);
      setViewStubId(stubRef.id);

      // 2) Mark payouts paid + backref stub id
      await Promise.all(
        payoutsToMark.map((p) =>
          setDoc(
            doc(collection(db, "payouts"), p.id),
            {
              paidAt: serverTimestamp(),
              payoutStubId: stubRef.id,
            },
            { merge: true }
          )
        )
      );

      // 3) UI cleanup
      setSelectedIds([]);
      setStubOpen(false);
    } catch (err) {
      console.error(err);
      alert("Failed to mark payouts as paid + create stub. See console.");
    } finally {
      setStubSaving(false);
    }
  }

  function toggleSelected(id: string) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  if (error) return <div className="p-6 text-red-600">{error}</div>;
  if (!employee) return <div className="p-6">Not found.</div>;

  return (
    <div className="mx-auto w-[min(900px,94vw)] py-8">
      <div
        onClick={() => navigate("/employees")}
        className="flex gap-0 items-center mb-10 cursor-pointer hover:underline group"
      >
        <button className="text-sm text-blue-600 opacity-60 group-hover:opacity-100 transition duration-200 ease-in-out ">
          <ChevronLeft />
        </button>
        <p>Back to Employees</p>
      </div>

      {/* Employee profile card (collapsible) */}
      <div className="rounded-2xl bg-white/50 shadow hover:bg-white transition duration-300 ease-in-out">
        {/* Header / toggle */}
        <button
          type="button"
          onClick={() => setProfileOpen((v) => !v)}
          className="flex w-full items-center justify-between px-6 py-4 text-left"
        >
          <div>
            <h1 className="text-xl font-semibold">Employee profile</h1>
            <p className="mt-1 text-xs text-gray-500">
              Click to {profileOpen ? "hide" : "view / edit"} employee details.
            </p>
          </div>

          <div className="flex items-center gap-3">
            {/* Small status pill in header */}
            <span
              className={
                "inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase " +
                (isActive
                  ? "bg-emerald-100 text-emerald-700"
                  : "bg-gray-200 text-gray-600")
              }
            >
              {isActive ? "Active" : "Inactive"}
            </span>

            <ChevronDown
              className={
                "h-5 w-5 text-gray-500 transition-transform " +
                (profileOpen ? "rotate-180" : "")
              }
            />
          </div>
        </button>

        {/* Body (only visible when expanded) */}
        {profileOpen && (
          <div className="border-t border-gray-100 px-6 pb-6">
            <div className="mt-4 space-y-4">
              {/* Name */}
              <div>
                <label className="text-xs text-gray-600">Name</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
              </div>

              {/* Status */}
              <div>
                <label className="text-xs text-gray-600">Status</label>
                <div className="mt-2 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setIsActive(true)}
                    className={
                      "rounded-full px-3 py-1 text-xs font-semibold uppercase " +
                      (isActive
                        ? "bg-emerald-600 text-white"
                        : "bg-gray-100 text-gray-600")
                    }
                  >
                    Active
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsActive(false)}
                    className={
                      "rounded-full px-3 py-1 text-xs font-semibold uppercase " +
                      (!isActive
                        ? "bg-gray-700 text-white"
                        : "bg-gray-100 text-gray-600")
                    }
                  >
                    Inactive
                  </button>
                </div>
                <p className="mt-1 text-[11px] text-gray-500">
                  Inactive employees stay in history and past payouts, but they
                  won&apos;t be selectable on new jobs.
                </p>
              </div>

              {/* Address */}
              <div>
                <label className="text-xs text-gray-600">
                  Address (optional, for your own records)
                </label>
                <input
                  value={address.fullLine}
                  onChange={(e) =>
                    setAddress((s) => ({ ...s, fullLine: e.target.value }))
                  }
                  placeholder="Full address line"
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
              </div>

              <div className="grid gap-2 sm:grid-cols-3">
                <input
                  value={address.city}
                  onChange={(e) =>
                    setAddress((s) => ({ ...s, city: e.target.value }))
                  }
                  placeholder="City"
                  className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
                <input
                  value={address.state}
                  onChange={(e) =>
                    setAddress((s) => ({ ...s, state: e.target.value }))
                  }
                  placeholder="State"
                  className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
                <input
                  value={address.zip}
                  onChange={(e) =>
                    setAddress((s) => ({ ...s, zip: e.target.value }))
                  }
                  placeholder="ZIP"
                  className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
              </div>

              <button
                onClick={save}
                disabled={saving}
                className="mt-2 rounded-lg bg-cyan-800 px-4 py-2 text-sm text-white hover:bg-cyan-700 disabled:opacity-60"
              >
                {saving ? "Saving…" : "Save changes"}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Payouts section */}
      <section className="mt-8 rounded-2xl bg-white/50 hover:bg-white transition duration-300 ease-in-out p-6 shadow">
        {/* HEADER */}
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-semibold">
                Payouts for {employee.name}
              </h2>

              <button
                type="button"
                onClick={() => setPayoutsOpen((v) => !v)}
                className="inline-flex items-center rounded-full border border-[var(--color-border)] bg-[var(--color-brown)] hover:bg-[var(--color-brown-hover)] transition duration-300 ease-in-out px-3 py-1 text-xs font-medium text-white"
              >
                <ChevronDown
                  className={`mr-1 h-4 w-4 transition-transform ${
                    payoutsOpen ? "rotate-0" : "-rotate-90"
                  }`}
                />
                <span className="hidden sm:inline">
                  {payoutsOpen ? "Collapse" : "Expand"}
                </span>
              </button>
            </div>

            <p className="text-xs text-gray-500">
              Track all jobs this employee has worked on. Use tabs to view
              pending vs paid payouts.
            </p>
          </div>

          {/* Search by address */}
          <div className="flex flex-col items-end gap-1">
            <label className="text-[10px] uppercase tracking-wide text-gray-500">
              Search by address
            </label>
            <input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Address, city, state, or ZIP…"
              className="w-full max-w-xs rounded-lg border border-gray-300 px-3 py-1.5 text-xs outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
            />
          </div>
        </div>

        {/* ✅ START: COLLAPSIBLE BODY */}
        {payoutsOpen && (
          <>
            {/* Tabs: All / Pending / Paid */}
            <div className="mb-3 inline-flex rounded-full border border-gray-200 bg-white p-1 text-xs">
              {(["all", "pending", "paid"] as PayoutFilter[]).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setPayoutFilter(f)}
                  className={
                    "px-3 py-1 rounded-full capitalize " +
                    (payoutFilter === f
                      ? "bg-cyan-800 text-white"
                      : "text-gray-700 hover:bg-gray-100")
                  }
                >
                  {f}
                </button>
              ))}
            </div>

            {/* Create stub button (pending only, when items selected) */}
            {/* Pending tab actions (Create stub + Clear all) */}
            {payoutFilter === "pending" && selectedIds.length > 0 && (
              <div className="mb-3 flex justify-between items-center">
                <div />

                <div className="flex items-center gap-2">
                  {/* CREATE STUB — match JobsPage green button */}
                  <button
                    type="button"
                    onClick={() => setStubOpen(true)}
                    className="rounded-lg bg-emerald-800 hover:bg-emerald-700 transition duration-300 ease-in-out px-3 py-1.5 text-xs font-semibold text-white"
                  >
                    Create stub ({selectedIds.length})
                  </button>

                  {/* CLEAR ALL — match JobsPage purple/brown button */}
                  <button
                    type="button"
                    onClick={() => setSelectedIds([])}
                    className="rounded-lg border border-[var(--color-border)] bg-[var(--color-primary-600)] hover:bg-[var(--color-primary)] px-3 py-1.5 text-xs font-medium text-white"
                  >
                    Clear all
                  </button>
                </div>
              </div>
            )}

            {/* List */}
            {payoutsLoading && (
              <p className="text-sm text-gray-500">Loading payouts…</p>
            )}
            {payoutsError && (
              <p className="text-sm text-red-600">{payoutsError}</p>
            )}
            {!payoutsLoading &&
              !payoutsError &&
              filteredPayouts.length === 0 && (
                <p className="text-sm text-gray-500">
                  No payouts match the current filters.
                </p>
              )}

            {!payoutsLoading && !payoutsError && filteredPayouts.length > 0 && (
              <div className="mt-2 max-h-[55vh] md:max-h-[420px] overflow-y-auto overscroll-contain rounded-xl bg-white/60 pr-2">
                <ul className="mt-1 divide-y divide-gray-100 rounded-xl bg-white/60">
                  {filteredPayouts.map((p) => {
                    const addr = normalizeJobAddress(p.jobAddressSnapshot);
                    const isChecked = selectedIds.includes(p.id);

                    return (
                      <li
                        key={p.id}
                        className="flex flex-col gap-2 px-3 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="flex items-start gap-2">
                          {payoutFilter === "pending" && (
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => toggleSelected(p.id)}
                              className="mt-1 h-4 w-4 rounded border-gray-300 text-cyan-700"
                            />
                          )}

                          <div>
                            <div className="font-medium text-gray-900">
                              {addr.display || "—"}
                            </div>
                            {(addr.city || addr.state || addr.zip) && (
                              <div className="text-xs text-gray-500">
                                {[addr.city, addr.state, addr.zip]
                                  .filter(Boolean)
                                  .join(", ")}
                              </div>
                            )}
                            <div className="mt-1 text-xs text-gray-600">
                              <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
                                {p.category || "payout"}
                              </span>
                              {typeof p.sqft === "number" &&
                                typeof p.ratePerSqFt === "number" && (
                                  <span className="ml-2">
                                    {p.sqft.toLocaleString()} sq.ft @ $
                                    {p.ratePerSqFt.toFixed(2)}/sq.ft
                                  </span>
                                )}
                            </div>
                            <div className="mt-1 text-[11px] text-gray-500">
                              Created: {fmtDate(p.createdAt as unknown)}
                              {p.paidAt && (
                                <> • Paid: {fmtDate(p.paidAt as unknown)}</>
                              )}
                              {!p.paidAt && (
                                <span className="ml-1 inline-flex items-center rounded-full bg-yellow-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-yellow-800">
                                  Pending
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center justify-between gap-3 sm:flex-col sm:items-end">
                          <div className="text-right">
                            <div className="text-[11px] text-gray-500">
                              Total
                            </div>
                            <div className="text-sm font-semibold text-gray-900">
                              {money(p.amountCents)}
                            </div>
                          </div>
                          {p.jobId && (
                            <button
                              type="button"
                              onClick={() => navigate(`/job/${p.jobId}`)}
                              className="rounded-md border border-gray-300 px-3 py-1 text-[11px] text-gray-700 hover:bg-gray-100"
                            >
                              View Job
                            </button>
                          )}
                          {p.paidAt && (
                            <span className="mt-1 inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-emerald-700">
                              Paid
                            </span>
                          )}
                          {!p.paidAt && payoutFilter !== "pending" && (
                            <span className="mt-1 inline-flex items-center rounded-full bg-yellow-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-yellow-800">
                              Pending
                            </span>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </>
        )}
        {/* ✅ END: COLLAPSIBLE BODY */}
      </section>

      <section className="mt-8 rounded-2xl bg-white/50 hover:bg-white transition duration-300 ease-in-out p-6 shadow">
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold">Pay Stubs History</h2>
            <p className="text-xs text-gray-500">
              Saved pay stubs created when you mark payouts as paid.
            </p>
          </div>

          <div className="flex flex-col items-end gap-1">
            <label className="text-[10px] uppercase tracking-wide text-gray-500">
              Search stubs
            </label>
            <input
              value={stubSearch}
              onChange={(e) => setStubSearch(e.target.value)}
              placeholder="Stub #, address, city, state, ZIP…"
              className="w-full max-w-xs rounded-lg border border-gray-300 px-3 py-1.5 text-xs outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
            />
          </div>
        </div>

        {stubsLoading && (
          <div className="text-sm text-gray-600">Loading stubs…</div>
        )}
        {stubsError && <div className="text-sm text-red-600">{stubsError}</div>}

        {!stubsLoading && !stubsError && filteredStubs.length === 0 && (
          <div className="text-sm text-gray-600">No stubs yet.</div>
        )}

        {!stubsLoading && !stubsError && filteredStubs.length > 0 && (
          <div className="space-y-2">
            {filteredStubs.map((s) => (
              <div
                key={s.id}
                className="flex flex-col gap-2 rounded-xl border border-gray-200 bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <div className="text-sm font-semibold text-gray-900">
                    {s.number}
                  </div>
                  <div className="text-[11px] text-gray-500">
                    {s.lines.length} payouts • Created {fmtDate(s.createdAt)}
                  </div>
                </div>

                <div className="flex items-center justify-between sm:justify-end gap-3">
                  <div className="text-sm font-semibold text-gray-900">
                    {money(s.totalCents)}
                  </div>
                  <button
                    type="button"
                    onClick={() => setViewStubId(s.id)}
                    className="rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-gray-800"
                  >
                    View
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Stub modal – now uses the same portal-based layout as JobsPage */}
      {stubOpen && employee && selectedPayouts.length > 0 && (
        <GlobalPayoutStubModal
          employee={employee}
          payouts={selectedPayouts}
          onClose={() => setStubOpen(false)}
          onConfirmPaid={markSelectedAsPaid}
          saving={stubSaving}
        />
      )}

      {stubToView && (
        <PayoutStubViewerModal
          stub={stubToView}
          employeeNameOverride={employee?.name}
          onClose={() => setViewStubId(null)}
        />
      )}
    </div>
  );
}

function normalizeEmployeeAddress(
  a: Employee["address"]
): EmployeeAddress | null {
  if (!a) return null;
  if (typeof a === "string") return { fullLine: a, line1: a };
  return a as EmployeeAddress;
}

// ---------- Stub Modal ----------
