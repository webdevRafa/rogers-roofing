import { useEffect, useState } from "react";
import {
  collection,
  doc,
  onSnapshot,
  query,
  orderBy,
  where,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";

import type { FieldValue } from "firebase/firestore";
import { useNavigate, useLocation } from "react-router-dom";
import { db } from "../firebase/firebaseConfig";
import type { Employee, EmployeeAddress } from "../types/types";
import { useOrg } from "../contexts/OrgContext";

export default function EmployeesPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const navigate = useNavigate();
  const location = useLocation();

  const { orgId, loading: orgLoading } = useOrg();

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<
    "roofer" | "foreman" | "technician" | "laborer" | "office" | "other"
  >("roofer");
  /**
   * Create or resend an invite for the given employee.
   * This creates a new employeeInvites doc and updates the employee’s invite metadata,
   * including an inviteDocId.  If the employee lacks an email, an error message is shown.
   */
  async function sendInviteFor(employee: Employee) {
    if (!orgId) {
      setError("No organization selected.");
      return;
    }

    try {
      if (!employee.email) {
        setError(
          "Employee is missing an email address. Please edit the employee and add an email before sending an invite."
        );
        return;
      }
      setError(null);
      const inviteRef = doc(collection(db, "employeeInvites"));
      const batch = writeBatch(db);
      const now = serverTimestamp() as FieldValue;
      // snapshot the current role/accessRole or fall back to sensible defaults
      const roleSnapshot = (employee.role || role) as any;
      const accessRoleSnapshot = (employee.accessRole || "crew") as any;

      // Create the invite document
      batch.set(inviteRef, {
        id: inviteRef.id,
        orgId,
        employeeId: employee.id,
        email: employee.email,
        status: "pending",
        roleSnapshot,
        accessRoleSnapshot,
        createdAt: now,
        createdByUserId: null,
      });

      // Update the employee’s invite metadata and save the inviteDocId
      batch.set(
        doc(db, "employees", employee.id),
        {
          invite: {
            status: "pending",
            email: employee.email,
            invitedAt: now,
            invitedByUserId: null,
            lastSentAt: now,
            inviteDocId: inviteRef.id,
          },
        },
        { merge: true }
      );

      await batch.commit();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    }
  }

  /**
   * Copy the acceptance link for a pending invite to the clipboard.
   * The inviteDocId must be present on the employee’s invite metadata.
   * Displays a browser alert on success or error.
   */
  function copyInviteLink(employee: Employee) {
    const inviteId = (employee as any).invite?.inviteDocId;
    if (!inviteId) {
      setError(
        "No invite found for this employee. Please send an invite first."
      );
      return;
    }
    const url = `${window.location.origin}/accept-invite?inviteId=${inviteId}`;
    navigator.clipboard
      .writeText(url)
      .then(() => {
        alert("Invite link copied to clipboard.");
      })
      .catch(() => {
        alert("Failed to copy invite link. Please copy manually: " + url);
      });
  }

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

  // Fetch employees
  useEffect(() => {
    setError(null);

    if (orgLoading) return;

    if (!orgId) {
      setEmployees([]);
      setError("No organization selected.");
      return;
    }

    const q = query(
      collection(db, "employees"),
      where("orgId", "==", orgId),
      orderBy("name", "asc")
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: Employee[] = snap.docs.map((docSnap) => ({
          id: docSnap.id,
          ...(docSnap.data() as Omit<Employee, "id">),
        }));
        setEmployees(list);
      },
      (err) => {
        console.error("Employees snapshot error:", err);
        setError(err.message || "Failed to load employees.");
        setEmployees([]);
      }
    );

    return () => unsub();
  }, [orgId, orgLoading]);

  async function createEmployee() {
    if (!name.trim()) return;
    if (!orgId) {
      setError("No organization selected.");
      return;
    }
    setCreating(true);
    setError(null);

    try {
      const employeeRef = doc(collection(db, "employees"));
      const inviteEmail = email.trim().toLowerCase();
      const hasInvite = inviteEmail.length > 0;

      const batch = writeBatch(db);

      const invitedByUserId = null; // placeholder for now (auth.uid later)

      const employee: Employee = {
        id: employeeRef.id,
        orgId,
        name: name.trim(),
        email: hasInvite ? inviteEmail : null,
        role: role as any,
        accessRole: "crew" as any,
        userId: null,
        isActive: true,
        invite: hasInvite
          ? {
              status: "pending",
              email: inviteEmail,
              invitedAt: serverTimestamp() as FieldValue,
              invitedByUserId,
              lastSentAt: serverTimestamp() as FieldValue,
            }
          : ({ status: "none" } as any),
        createdAt: serverTimestamp() as FieldValue,
        updatedAt: serverTimestamp() as FieldValue,
      };

      batch.set(employeeRef, employee);

      if (hasInvite) {
        const inviteRef = doc(collection(db, "employeeInvites"));
        batch.set(inviteRef, {
          id: inviteRef.id,
          orgId,
          employeeId: employeeRef.id,
          email: inviteEmail,
          status: "pending",
          roleSnapshot: role,
          accessRoleSnapshot: "crew",
          createdAt: serverTimestamp(),
          createdByUserId: invitedByUserId,
        });
        // Also store the inviteDocId on the employee’s invite metadata
        batch.set(
          employeeRef,
          {
            invite: {
              ...(employee.invite || {}),
              inviteDocId: inviteRef.id,
            },
          },
          { merge: true }
        );
      }

      await batch.commit();

      setName("");
      setEmail("");
      setRole("roofer");

      navigate(`/employees/${employeeRef.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }

  return (
    <main className="admin-page members-page">
      <div className="admin-content-width">
        <header className="admin-page-header">
          <div>
            <span className="admin-kicker">Team and access</span>
            <h1>Members</h1>
            <p>
              Keep your field and office team organized, assign roles, and
              manage workspace invitations.
            </p>
          </div>
        </header>

        {/* Add employee */}
        <section className="admin-card members-create-card">
          <div className="members-create-heading">
            <span className="admin-kicker">Add to your crew</span>
            <h2>
              New team member
            </h2>
            <p>
              Add their basic details now. You can complete contact and payout
              information from their member profile.
            </p>
          </div>

            <div className="members-create-form">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Employee name"
                aria-label="Employee name"
              />

              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email (optional, for invite)"
                aria-label="Employee email"
              />

              <select
                value={role}
                onChange={(e) => setRole(e.target.value as any)}
                aria-label="Employee role"
              >
                <option value="roofer">Roofer</option>
                <option value="foreman">Foreman</option>
                <option value="technician">Technician</option>
                <option value="laborer">Laborer</option>
                <option value="office">Office</option>
                <option value="other">Other</option>
              </select>

              <button
                onClick={createEmployee}
                disabled={creating || !name.trim()}
                className="admin-primary-button"
              >
                {creating ? "Saving…" : "Add member"}
              </button>
            </div>

          {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

          {successMessage && (
            <p className="mt-2 inline-block rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-700 border border-emerald-200">
              {successMessage}
            </p>
          )}
        </section>

        {/* List */}
        <section className="admin-card members-workspace">
          <div className="members-list-heading">
            <div>
              <span className="admin-kicker">Team directory</span>
              <h2>All members</h2>
            </div>
            <p>
              Active employees can be selected on jobs. Inactive stay for
              history only.
            </p>
          </div>

          {employees.length === 0 ? (
            <div className="admin-empty">
              <strong>No team members yet</strong>
              <p>Add your first team member using the form above.</p>
            </div>
          ) : (
            <ul className="members-list">
              {employees.map((e) => {
                const addr = normalizeEmployeeAddress(e.address);
                const active = e.isActive !== false;

                return (
                  <li
                    key={e.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => navigate(`/employees/${e.id}`)}
                    onKeyDown={(ev) => {
                      if (ev.key === "Enter" || ev.key === " ") {
                        ev.preventDefault();
                        navigate(`/employees/${e.id}`);
                      }
                    }}
                    className="member-row"
                  >
                    {/* Left side: employee name and address */}
                    <div className="pr-4">
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

                    {/* Right side: invite status and actions */}
                    <div className="flex flex-col items-end space-y-1">
                      {/* Status chip */}
                      <div>
                        {(() => {
                          const status = (e as any).invite?.status || "none";
                          switch (status) {
                            case "pending":
                              return (
                                <span className="inline-flex items-center rounded-full bg-yellow-100 text-yellow-800 px-2 py-0.5 text-[10px] font-semibold uppercase">
                                  Pending
                                </span>
                              );
                            case "accepted":
                              return (
                                <span className="inline-flex items-center rounded-full bg-emerald-100 text-emerald-700 px-2 py-0.5 text-[10px] font-semibold uppercase">
                                  Accepted
                                </span>
                              );
                            case "revoked":
                              return (
                                <span className="inline-flex items-center rounded-full bg-red-100 text-red-700 px-2 py-0.5 text-[10px] font-semibold uppercase">
                                  Revoked
                                </span>
                              );
                            case "expired":
                              return (
                                <span className="inline-flex items-center rounded-full bg-gray-200 text-gray-600 px-2 py-0.5 text-[10px] font-semibold uppercase">
                                  Expired
                                </span>
                              );
                            case "none":
                            default:
                              return (
                                <span className="inline-flex items-center rounded-full bg-gray-100 text-gray-600 px-2 py-0.5 text-[10px] font-semibold uppercase">
                                  No Invite
                                </span>
                              );
                          }
                        })()}
                      </div>
                      {/* Invite action buttons */}
                      <div className="flex gap-2">
                        {(() => {
                          const invite = (e as any).invite || {};
                          const status = invite.status || "none";
                          if (status === "pending") {
                            return (
                              <>
                                <button
                                  type="button"
                                  onClick={(ev) => {
                                    ev.stopPropagation();
                                    sendInviteFor(e);
                                  }}
                                  className="text-xs text-blue-600 hover:underline"
                                >
                                  Resend
                                </button>
                                <button
                                  type="button"
                                  onClick={(ev) => {
                                    ev.stopPropagation();
                                    copyInviteLink(e);
                                  }}
                                  className="text-xs text-blue-600 hover:underline"
                                >
                                  Copy Link
                                </button>
                              </>
                            );
                          }
                          if (status === "none" || !status) {
                            if (e.email) {
                              return (
                                <button
                                  type="button"
                                  onClick={(ev) => {
                                    ev.stopPropagation();
                                    sendInviteFor(e);
                                  }}
                                  className="text-xs text-blue-600 hover:underline"
                                >
                                  Invite
                                </button>
                              );
                            }
                            return (
                              <span className="text-xs text-gray-400 italic">
                                Add email to invite
                              </span>
                            );
                          }
                          // For accepted or other statuses, no actions
                          return null;
                        })()}
                      </div>
                      {/* View/Edit button */}
                      <button
                        type="button"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          navigate(`/employees/${e.id}`);
                        }}
                        className="text-xs text-blue-600 hover:underline"
                      >
                        View / Edit
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </main>
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
