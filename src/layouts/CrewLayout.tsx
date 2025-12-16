import type { PropsWithChildren } from "react";
import { Link, Outlet, useNavigate } from "react-router-dom";
import { getAuth } from "firebase/auth";
import { useCurrentEmployee } from "../hooks/useCurrentEmployee";

/**
 * CrewLayout provides a minimal navigation wrapper for crew-facing
 * pages. It displays the current employee's name, links to the crew
 * dashboard and profile (if desired), and a sign out button. The
 * Outlet is used to render nested routes.
 */
export default function CrewLayout({ children }: PropsWithChildren<{}>) {
  const { employee } = useCurrentEmployee();
  const navigate = useNavigate();
  function handleSignOut() {
    const auth = getAuth();
    auth.signOut().then(() => {
      navigate("/login");
    });
  }
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow">
        <div className="mx-auto max-w-5xl px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/crew" className="text-lg font-semibold text-gray-900">
              Rogers Roofing
            </Link>
            <nav className="ml-6 space-x-4">
              <Link
                to="/crew"
                className="text-sm font-medium text-gray-700 hover:text-gray-900"
              >
                My Jobs
              </Link>
              {/* Future: add profile or other links here */}
            </nav>
          </div>
          <div className="flex items-center gap-4">
            {employee && (
              <span className="text-sm text-gray-700">
                {employee.name || employee.email || "Crew"}
              </span>
            )}
            <button
              onClick={handleSignOut}
              className="text-sm font-medium text-red-600 hover:text-red-700"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl p-4">
        {/* Render children or nested routes via outlet */}
        {children || <Outlet />}
      </main>
    </div>
  );
}
