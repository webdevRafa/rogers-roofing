import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useCurrentEmployee } from "../hooks/useCurrentEmployee";
import { getAuth } from "firebase/auth";

export type RoleGuardProps = {
  /**
   * List of access roles allowed to view the children. Use values
   * from the AccessRole union type defined in types.ts (e.g. 'admin',
   * 'manager', 'crew', 'readOnly').
   */
  allowedRoles: string[];
  children: ReactNode;
  /** Optional fallback element to render if access is denied. */
  fallback?: ReactNode;
};

/**
 * RoleGuard restricts its children to users whose Employee.accessRole
 * appears in the allowedRoles array. It uses the useCurrentEmployee
 * hook to fetch the current employee. While loading, it renders
 * nothing; unauthenticated users are redirected to /login. If the
 * employee does not exist or their accessRole is not allowed, the
 * fallback is rendered (or an access denied message by default).
 */
export default function RoleGuard({
  allowedRoles,
  children,
  fallback,
}: RoleGuardProps) {
  const { employee, loading } = useCurrentEmployee();
  const auth = getAuth();
  // Show nothing while determining auth/employee
  if (loading) return null;
  // Not signed in? Redirect to login
  if (!auth.currentUser) {
    return <Navigate to="/login" replace />;
  }
  // If no employee record yet, treat as no access
  if (!employee || !employee.accessRole) {
    return <>{fallback ?? <div className="p-6">Access denied.</div>}</>;
  }
  const role = employee.accessRole;
  if (!allowedRoles.includes(role)) {
    return <>{fallback ?? <div className="p-6">Access denied.</div>}</>;
  }
  return <>{children}</>;
}
