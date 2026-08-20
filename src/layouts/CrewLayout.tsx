// src/layouts/CrewLayout.tsx
//
// Crew-facing layout with a polished, consistent navbar (modeled after AdminLayout).
// Keeps the crew experience lightweight: "My Jobs" + optional future links,
// employee identity chip, and a clear Sign out action.
//
// Notes:
// - Uses your existing `useCurrentEmployee()` hook.
// - Supports nested routes via <Outlet /> and optional children override.

import type { PropsWithChildren } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useState } from "react";
import { getAuth } from "firebase/auth";
import { ClipboardList, LogOut, Menu, X, UserRound } from "lucide-react";

import { useCurrentEmployee } from "../hooks/useCurrentEmployee";
import logo from "../assets/rogers-roofing.webp"; // adjust if needed

function navLinkBase(isActive: boolean) {
  return (
    "inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition " +
    (isActive
      ? "bg-white/20 text-white"
      : "text-white/85 hover:bg-white/10 hover:text-white")
  );
}

export default function CrewLayout({ children }: PropsWithChildren<{}>) {
  const navigate = useNavigate();
  const { employee } = useCurrentEmployee();

  const [signingOut, setSigningOut] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const displayName =
    employee?.name?.trim() || employee?.email?.trim() || "Crew";

  async function handleSignOut() {
    try {
      setSigningOut(true);
      await getAuth().signOut();
      navigate("/login");
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <div className="min-h-screen">
      {/* Crew Navbar */}
      <header className="sticky top-0 z-40 select-none">
        <div className="bg-gradient-to-tr from-[var(--color-brown-hover)] via-[var(--color-brown)] to-[var(--color-logo)]">
          <div className="mx-auto w-[min(1100px,94vw)] py-6">
            <div className="flex items-center justify-between gap-3">
              {/* Brand */}
              <button
                onClick={() => navigate("/crew")}
                className="flex items-center gap-3 text-left"
                aria-label="Go to crew dashboard"
              >
                <img
                  src={logo}
                  alt="Roger's Roofing logo"
                  className="h-10 w-10 rounded-xl shadow-md"
                />
                <div className="hidden sm:block">
                  <div className="text-sm font-semibold text-white leading-4">
                    Roger&apos;s Roofing
                  </div>
                  <div className="text-[11px] text-white/75">
                    Crew Portal • My Jobs
                  </div>
                </div>
              </button>

              {/* Desktop Nav */}
              <nav className="hidden md:flex items-center gap-2">
                <NavLink
                  to="/crew"
                  className={({ isActive }) => navLinkBase(isActive)}
                  end
                >
                  <ClipboardList className="h-4 w-4" />
                  My Jobs
                </NavLink>

                {/* Future examples:
                <NavLink to="/crew/profile" className={({isActive}) => navLinkBase(isActive)}>
                  <UserRound className="h-4 w-4" />
                  Profile
                </NavLink>
                */}
              </nav>

              {/* Actions */}
              <div className="flex items-center gap-2">
                {/* Employee chip */}
                <div className="hidden sm:inline-flex items-center gap-2 rounded-lg bg-white/10 px-3 py-2 text-sm text-white/90">
                  <UserRound className="h-4 w-4" />
                  <span className="max-w-[220px] truncate">{displayName}</span>
                </div>

                {/* Sign out */}
                <button
                  onClick={handleSignOut}
                  disabled={signingOut}
                  className="inline-flex items-center justify-center rounded-lg bg-red-800 px-3 py-2 text-sm font-semibold text-white hover:bg-red-600 disabled:opacity-60"
                  aria-label="Sign out"
                  title={signingOut ? "Signing out…" : "Sign out"}
                >
                  <LogOut className="h-4 w-4" />
                </button>

                {/* Mobile menu */}
                <button
                  type="button"
                  className="md:hidden inline-flex items-center justify-center rounded-lg bg-white/10 px-3 py-2 text-white hover:bg-white/20"
                  onClick={() => setMobileOpen((v) => !v)}
                  aria-label="Menu"
                >
                  {mobileOpen ? (
                    <X className="h-4 w-4" />
                  ) : (
                    <Menu className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>

            {/* Mobile Nav Panel */}
            {mobileOpen && (
              <div className="md:hidden mt-3 rounded-2xl bg-white/10 p-2 backdrop-blur">
                <div className="grid gap-1">
                  <NavLink
                    to="/crew"
                    end
                    onClick={() => setMobileOpen(false)}
                    className={({ isActive }) => navLinkBase(isActive)}
                  >
                    <ClipboardList className="h-4 w-4" />
                    My Jobs
                  </NavLink>

                  {/* Employee identity (mobile) */}
                  <div className="mt-1 rounded-xl bg-white/10 px-3 py-2 text-xs text-white/90">
                    Signed in as{" "}
                    <span className="font-semibold">{displayName}</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="mx-auto w-full max-w-[1700px] py-6 sm:py-10">
        {children || <Outlet />}
      </main>
    </div>
  );
}
