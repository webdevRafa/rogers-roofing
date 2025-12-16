import type { ReactNode } from "react";
import { useCurrentEmployee } from "../hooks/useCurrentEmployee";
import { Link } from "react-router-dom";
import { getAuth } from "firebase/auth";

/**
 * AdminGuard restricts access to users whose Employee.accessRole is
 * 'admin' or 'manager'. It shows a loading indicator while the auth
 * and employee record are being fetched. If the user is not signed
 * in, it prompts them to log in. If the user's accessRole does not
 * include admin privileges, an access denied message is shown.
 */
export default function AdminGuard({ children }: { children: ReactNode }) {
  const { employee, loading } = useCurrentEmployee();
  const auth = getAuth();
  if (loading) {
    return (
      <div className="min-h-[60vh] grid place-items-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-gray-300 border-t-gray-700" />
          <p className="text-sm text-gray-500">Checking access…</p>
        </div>
      </div>
    );
  }
  if (!auth.currentUser) {
    return (
      <div className="min-h-[60vh] grid place-items-center">
        <div className="rounded-2xl border border-gray-200 bg-white p-6 text-center">
          <h2 className="text-lg font-semibold">Sign in required</h2>
          <p className="mt-1 text-sm text-gray-600">
            You must be signed in to view this page.
          </p>
          <Link
            to="/login"
            className="mt-4 inline-block rounded-lg bg-cyan-800 px-4 py-2 text-white hover:bg-cyan-700 transition"
          >
            Go to Login
          </Link>
        </div>
      </div>
    );
  }
  const role = employee?.accessRole;
  const isAdmin = role === "admin" || role === "manager";
  if (!isAdmin) {
    return (
      <div className="min-h-[60vh] grid place-items-center">
        <div className="rounded-2xl border border-gray-200 bg-white p-6 text-center">
          <h2 className="text-lg font-semibold">Access denied</h2>
          <p className="mt-1 text-sm text-gray-600">
            Your account doesn’t have permission to view this page.
          </p>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}
