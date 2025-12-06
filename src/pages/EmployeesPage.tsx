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
        isActive: true, // ✅ new employees start as active
        createdAt: serverTimestamp() as FieldValue,
        updatedAt: serverTimestamp() as FieldValue,
      };

      await setDoc(ref, employee);

      // Clear input
      setName("");

      // Redirect to the newly created employee detail page
      navigate(`/employees/${ref.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }

  return (
    <>
      <div className="bg-gradient-to-b from-indigo-900 to-[var(--color-logo)] py-15 px-4 md:px-0">
        <div className="max-w-[1200px] mx-auto">
          <h1 className="text-4xl font-semibold text-white">Employees</h1>
          <button
            onClick={() => navigate("/jobs")}
            className="text-sm text-neutral-200 hover:underline"
          >
            ← Back to Jobs
          </button>
        </div>
      </div>
      <div className="mx-auto max-w-[1200px] py-8 ">
        {/* Add employee */}
        <section className="mb-6 rounded-xl  p-4 shadow">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between max-w-[500px]">
            <h2 className="text-lg font-medium">Add new employee</h2>
            <div className="flex gap-2 flex-row sm:items-center">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Employee name"
                className="w-full max-w-[300px] rounded-lg border border-[var(--color-border)]/50 bg-white  px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
              />
              <button
                onClick={createEmployee}
                disabled={creating || !name.trim()}
                className="rounded-lg bg-gradient-to-b from-indigo-900 to-[var(--color-logo)] px-4 py-1.5 text-xs text-white hover:bg-cyan-600 disabled:opacity-60 transition duration-300 ease-in-out"
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
          <div className="mb-2 flex flex-col md:flex-row items-start md:items-center justify-between md:justify-start gap-5">
            <h2 className="text-xl font-medium">All employees</h2>
            <p className="text-xs text-gray-500">
              Active employees can be selected on jobs. Inactive stay for
              history only.
            </p>
          </div>

          {employees.length === 0 ? (
            <p className="text-sm text-gray-500">No employees yet.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {employees.map((e) => {
                const addr = normalizeEmployeeAddress(e.address);
                const active = e.isActive !== false; // default to active if missing

                return (
                  <Link
                    to={`/employees/${e.id}`}
                    className="text-xs text-blue-600 hover:underline style-none"
                  >
                    <li
                      key={e.id}
                      className="flex items-center justify-between py-4 px-4 rounded-md hover:bg-white transition duration-300 ease-in-out"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <div className="text-sm font-medium">{e.name}</div>
                          <span
                            className={
                              "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase " +
                              (active
                                ? "bg-emerald-100 text-emerald-700"
                                : "bg-gray-200 text-gray-600")
                            }
                          >
                            {active ? "Active" : "Inactive"}
                          </span>
                        </div>
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
                  </Link>
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
