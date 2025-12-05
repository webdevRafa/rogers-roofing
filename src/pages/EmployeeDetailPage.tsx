import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  collection,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import type { FieldValue } from "firebase/firestore";
import { db } from "../firebase/firebaseConfig";
import type { Employee, EmployeeAddress } from "../types/types";

export default function EmployeeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [loading, setLoading] = useState(true);
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
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  async function save() {
    if (!employee) return;
    setSaving(true);
    setError(null);
    try {
      const ref = doc(collection(db, "employees"), employee.id);
      const next: Employee = {
        ...employee,
        name: name.trim(),
        address: cleanupAddress(address),
        updatedAt: serverTimestamp() as FieldValue,
      };
      await setDoc(ref, next, { merge: true });
      setEmployee(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="p-6">Loading…</div>;
  if (error) return <div className="p-6 text-red-600">{error}</div>;
  if (!employee) return <div className="p-6">Not found.</div>;

  return (
    <div className="mx-auto w-[min(700px,94vw)] py-8 pt-40">
      <button
        onClick={() => navigate("/employees")}
        className="mb-4 text-sm text-blue-600 hover:underline"
      >
        ← Back to Employees
      </button>

      <div className="rounded-2xl bg-white/50 p-6 shadow">
        <h1 className="mb-4 text-xl font-semibold">Employee profile</h1>

        <div className="space-y-4">
          <div>
            <label className="text-xs text-gray-600">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="text-xs text-gray-600">Address (optional)</label>
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

function cleanupAddress(addr: EmployeeAddress): EmployeeAddress | undefined {
  const hasAny = Object.values(addr).some((v) => v && v.trim?.().length);
  return hasAny ? addr : undefined;
}
