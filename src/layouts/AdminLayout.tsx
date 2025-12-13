// src/layouts/AdminLayout.tsx
import { Outlet, NavLink, useNavigate } from "react-router-dom";
import { useState } from "react";
import { getAuth, signOut } from "firebase/auth";
import {
  CalendarDays,
  LayoutDashboard,
  Users,
  FileText,
  LogOut,
  Menu,
  X,
} from "lucide-react";

import logo from "../assets/rogers-roofing.webp"; // adjust if needed

function navLinkBase(isActive: boolean) {
  return (
    "inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition " +
    (isActive
      ? "bg-white/20 text-white"
      : "text-white/85 hover:bg-white/10 hover:text-white")
  );
}

export default function AdminLayout() {
  const navigate = useNavigate();

  const [signingOut, setSigningOut] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  async function handleLogout() {
    try {
      setSigningOut(true);
      await signOut(getAuth());
      navigate("/");
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <div className="min-h-screen ">
      {/* Global Navbar */}
      <header className="sticky top-0 z-40">
        <div className="bg-gradient-to-tr from-[var(--color-logo)] via-[var(--color-brown)] to-[var(--color-logo)]">
          <div className="mx-auto w-[min(1200px,94vw)] py-8">
            <div className="flex items-center justify-between gap-3">
              {/* Brand */}
              <button
                onClick={() => navigate("/dashboard")}
                className="flex items-center gap-3 text-left"
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
                    Jobs • Scheduling • Payouts
                  </div>
                </div>
              </button>

              {/* Desktop Nav */}
              <nav className="hidden md:flex items-center gap-2">
                <NavLink
                  to="/dashboard"
                  className={({ isActive }) => navLinkBase(isActive)}
                >
                  <LayoutDashboard className="h-4 w-4" />
                  Dashboard
                </NavLink>
                <NavLink
                  to="/schedule"
                  className={({ isActive }) => navLinkBase(isActive)}
                >
                  <CalendarDays className="h-4 w-4" />
                  Schedule
                </NavLink>
                <NavLink
                  to="/employees"
                  className={({ isActive }) => navLinkBase(isActive)}
                >
                  <Users className="h-4 w-4" />
                  Employees
                </NavLink>

                {/* Optional route (keep if you want invoices in global nav) */}
                <NavLink
                  to="/invoices/placeholder"
                  className={({ isActive }) => navLinkBase(isActive)}
                >
                  <FileText className="h-4 w-4" />
                  Invoices
                </NavLink>
              </nav>

              {/* Actions */}
              <div className="flex items-center gap-2">
                {/* Logout */}
                <button
                  onClick={handleLogout}
                  disabled={signingOut}
                  className="inline-flex items-center justify-center rounded-lg bg-red-800 px-3 py-2 text-sm font-semibold text-white hover:bg-red-600 disabled:opacity-60"
                  aria-label="Sign out"
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
                    to="/dashboard"
                    onClick={() => setMobileOpen(false)}
                    className={({ isActive }) => navLinkBase(isActive)}
                  >
                    <LayoutDashboard className="h-4 w-4" />
                    Dashboard
                  </NavLink>
                  <NavLink
                    to="/schedule"
                    onClick={() => setMobileOpen(false)}
                    className={({ isActive }) => navLinkBase(isActive)}
                  >
                    <CalendarDays className="h-4 w-4" />
                    Schedule
                  </NavLink>
                  <NavLink
                    to="/employees"
                    onClick={() => setMobileOpen(false)}
                    className={({ isActive }) => navLinkBase(isActive)}
                  >
                    <Users className="h-4 w-4" />
                    Employees
                  </NavLink>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Page content */}
      <main className="mx-auto w-[min(1200px,94vw)] py-6 sm:py-10">
        <Outlet />
      </main>
    </div>
  );
}
