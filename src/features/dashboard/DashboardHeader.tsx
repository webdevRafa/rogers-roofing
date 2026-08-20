import logo from "../../assets/rogers-roofing.webp";
import { LogOut, CalendarDays, Users } from "lucide-react";

type DashboardHeaderProps = {
  onGoToEmployees: () => void;
  onGoToPunchCalendar: () => void;
  onLogout: () => void;
  signingOut: boolean;
};

export function DashboardHeader({
  onGoToEmployees,
  onGoToPunchCalendar,
  onLogout,
  signingOut,
}: DashboardHeaderProps) {
  return (
    <>
      {/* Gradient logo bar */}
      <div className="bg-gradient-to-tr from-[var(--color-logo)] via-[var(--color-brown)] to-[var(--color-logo)]">
        <nav className="top-0 z-10 backdrop-blur">
          <div className="mx-auto max-w-[1200px] flex items-center justify-between py-10 px-4 lg:px-0">
            <div className="text-lg md:text-3xl poppins text-white uppercase flex justify-between w-full items-center">
              Roger&apos;s Roofing &amp; Contracting LLC
              <img
                className="max-w-[100px] md:max-w-[150px] rounded-2xl shadow-md"
                src={logo}
                alt="Roger's Roofing logo"
              />
            </div>
          </div>
        </nav>
        {/* MAIN NAV BUTTONS (icon-only with hover labels) */}
        <div className="max-w-[1200px] mx-auto pb-1 md:pb-5 flex gap-4 justify-between items-center px-4 lg:px-0">
          <div className="flex gap-2">
            {/* Employees */}
            <button
              onClick={onGoToEmployees}
              className="group cursor-pointer relative flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--color-border)] bg-white/80 text-[var(--color-text)] hover:bg-[var(--color-card-hover)]"
              aria-label="Employees"
            >
              <Users className="h-4 w-4" />
              <span className="pointer-events-none absolute -bottom-10 left-1/2 -translate-x-1/2 rounded-md bg-black/80 px-2 py-0.5 text-[10px] text-white opacity-0 transition-all duration-150 group-hover:translate-y-0 group-hover:opacity-100">
                Employees
              </span>
            </button>

            {/* Punch Calendar */}
            <button
              onClick={onGoToPunchCalendar}
              className="group cursor-pointer relative flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--color-border)] bg-white/80 text-[var(--color-text)] hover:bg-[var(--color-card-hover)]"
              aria-label="Punch Calendar"
            >
              <CalendarDays className="h-4 w-4" />
              <span className="pointer-events-none absolute -bottom-8 left-1/2 -translate-x-1/2 rounded-md bg-black/80 px-2 py-0.5 text-[10px] text-white opacity-0 transition-all duration-150 group-hover:translate-y-0 group-hover:opacity-100">
                Calendar
              </span>
            </button>
          </div>

          {/* Sign out */}
          <button
            onClick={onLogout}
            disabled={signingOut}
            className="group relative flex h-9 w-9 items-center justify-center rounded-lg  bg-red-800 hover:bg-red-600 cursor-pointer text-white disabled:opacity-50"
            aria-label="Sign out"
          >
            <LogOut className="h-4 w-4" />
            <span className="pointer-events-none absolute -bottom-12 left-1/2 -translate-x-1/2 rounded-md bg-black/80 px-2 py-0.5 text-[10px] text-white opacity-0 transition-all duration-150 group-hover:translate-y-0 group-hover:opacity-100">
              {signingOut ? "Signing out…" : "Sign out"}
            </span>
          </button>
        </div>
      </div>
    </>
  );
}
