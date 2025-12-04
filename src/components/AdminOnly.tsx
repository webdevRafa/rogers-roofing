// src/components/AdminOnly.tsx
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import type { User } from "firebase/auth";
import { Link } from "react-router-dom";

const ADMIN_EMAILS = [
  "rogersroofing23@gmail.com",
  "ralphvdo420@gmail.com",
] as const;

export default function AdminOnly({ children }: { children: ReactNode }) {
  const [authLoading, setAuthLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    const auth = getAuth();
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthLoading(false);
    });
    return () => unsub();
  }, []);

  if (authLoading) {
    return (
      <div className="min-h-[60vh] grid place-items-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-gray-300 border-t-gray-700" />
          <p className="text-sm text-gray-500">Checking access…</p>
        </div>
      </div>
    );
  }

  if (!user) {
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

  const userEmail = user.email?.toLowerCase() ?? "";
  const isAdmin = ADMIN_EMAILS.some((e) => e.toLowerCase() === userEmail);

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
