import { useEffect, useState } from "react";
import {
  collection,
  doc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import type { FieldValue } from "firebase/firestore";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { db } from "../firebase/firebaseConfig";
import type { Employee, EmployeeAddress } from "../types/types";

export default function EmployeesPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const location = useLocation();
  const successMessage =
    (location.state as { message?: string } | null)?.message ?? null;

  // Auto-clear message
  useEffect(() => {
    if (!successMessage) return;
    const timer = setTimeout(() => {
      navigate("/employees", { replace: true, state: {} });
    }, 3000);
    return () => clearTimeout(timer);
  }, [successMessage, navigate]);

  useEffect(() => {
    const q = query(collection(db, "employees"), orderBy("name", "asc"));

    const unsub = onSnapshot(q, (snap) => {
      const list: Employee[] = snap.docs.map((docSnap) => ({
        id: docSnap.id,
        ...(docSnap.data() as Omit<Employee, "id">),
      }));
      setEmployees(list);
    });

    return () => unsub();
  }, []);

  async function createEmployee() {
    if (!name.trim()) return;

    setCreating(true);
    setError(null);

    try {
      const ref = doc(collection(db, "employees"));

      const employee: Employee = {
        id: ref.id,
        name: name.trim(),
        isActive: true,
        createdAt: serverTimestamp() as FieldValue,
        updatedAt: serverTimestamp() as FieldValue,
      };

      await setDoc(ref, employee);

      // Clear input
      setName("");

      // ⭐ Redirect to the newly created employee detail page
      navigate(`/employees/${ref.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }

  return (
    <>
      <div className="mx-auto max-w-[1200px] py-8 pt-40">
        <header className="mb-6 flex items-center justify-between">
          <h1 className="text-xl font-semibold">Employees</h1>
          <button
            onClick={() => navigate("/jobs")}
            className="text-sm text-blue-600 hover:underline"
          >
            ← Back to Jobs
          </button>
        </header>

        {/* Add employee */}
        <section className="mb-6 rounded-xl bg-white/30 p-4 shadow">
          <div className="flex gap-3 items-center">
            <h2 className="text-lg font-medium">Add new employee</h2>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Employee name"
                className="w-full max-w-[300px] rounded-lg border border-[var(--color-border)] bg-white/80 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
              />
              <button
                onClick={createEmployee}
                disabled={creating || !name.trim()}
                className="rounded-lg bg-cyan-700 px-4 py-0.5 text-xs text-white hover:bg-cyan-600 disabled:opacity-60 transition duration-300 ease-in-out"
              >
                {creating ? "Saving…" : "Add"}
              </button>
            </div>
          </div>

          {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

          {successMessage && (
            <p className="mt-2 inline-block rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-700 border border-emerald-200">
              {successMessage}
            </p>
          )}
        </section>

        {/* List */}
        <section className="rounded-xl bg-white/30 p-4 shadow">
          <h2 className="mb-2 text-xl font-medium">Current employees</h2>
          {employees.length === 0 ? (
            <p className="text-sm text-gray-500">No employees yet.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {employees.map((e) => {
                const addr = normalizeEmployeeAddress(e.address);
                return (
                  <li
                    key={e.id}
                    className="flex items-center justify-between py-2 px-4 rounded-md hover:bg-white transition duration-300 ease-in-out"
                  >
                    <div>
                      <div className="text-sm font-medium">{e.name}</div>
                      {addr && (
                        <div className="text-xs text-gray-500">
                          {addr.fullLine ||
                            [addr.line1, addr.city, addr.state, addr.zip]
                              .filter(Boolean)
                              .join(", ")}
                        </div>
                      )}
                    </div>
                    <Link
                      to={`/employees/${e.id}`}
                      className="text-xs text-blue-600 hover:underline"
                    >
                      View / Edit
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}

function normalizeEmployeeAddress(
  a: Employee["address"]
): EmployeeAddress | null {
  if (!a) return null;
  if (typeof a === "string") {
    return { fullLine: a, line1: a };
  }
  return a as EmployeeAddress;
}
