import { useMemo, useState } from "react";
import { getAuth, signOut } from "firebase/auth";
import {
  BarChart3,
  BriefcaseBusiness,
  CalendarDays,
  ChevronDown,
  FileStack,
  HandCoins,
  LayoutDashboard,
  LogOut,
  Menu,
  PackageSearch,
  Search,
  Users,
  UserRoundSearch,
  X,
} from "lucide-react";
import {
  Link,
  NavLink,
  Outlet,
  useLocation,
  useNavigate,
} from "react-router-dom";

import { OrgProvider } from "../contexts/OrgContext";
import { useCurrentEmployee } from "../hooks/useCurrentEmployee";
import { useMembership } from "../hooks/useMembership";
import logo from "../assets/rogers-roofing.webp";

const navigation = [
  { to: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { to: "/jobs", label: "Jobs", icon: BriefcaseBusiness },
  { to: "/leads", label: "Requests", icon: UserRoundSearch },
  { to: "/invoices-page", label: "Documents", icon: FileStack },
  { to: "/payouts", label: "Payouts", icon: HandCoins },
  { to: "/employees", label: "Members", icon: Users },
  { to: "/materials", label: "Materials", icon: PackageSearch },
  { to: "/schedule", label: "Schedule", icon: CalendarDays },
  { to: "/financial-overview", label: "Reports", icon: BarChart3 },
];

const routeLabels: Record<string, string> = {
  dashboard: "Overview",
  jobs: "Jobs",
  job: "Job workspace",
  leads: "Estimate requests",
  "invoices-page": "Documents",
  invoices: "Invoice",
  payouts: "Payouts",
  employees: "Members",
  materials: "Materials",
  schedule: "Schedule",
  "financial-overview": "Reports",
};

export default function AdminLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { employee } = useCurrentEmployee();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const {
    memberships,
    orgId: activeOrgId,
    activeOrgName,
    setActiveOrgId,
    loading: membershipLoading,
  } = useMembership();

  const currentLabel = useMemo(() => {
    const firstPart = location.pathname.split("/").filter(Boolean)[0] ?? "";
    return routeLabels[firstPart] ?? "Workspace";
  }, [location.pathname]);

  async function handleLogout() {
    setSigningOut(true);
    try {
      await signOut(getAuth());
      navigate("/login", { replace: true });
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <div className="admin-shell">
      {mobileOpen && (
        <button
          type="button"
          className="admin-mobile-scrim"
          onClick={() => setMobileOpen(false)}
          aria-label="Close navigation"
        />
      )}

      <aside className={mobileOpen ? "admin-sidebar is-open" : "admin-sidebar"}>
        <div className="admin-sidebar-brand">
          <Link to="/dashboard" onClick={() => setMobileOpen(false)}>
            <img src={logo} alt="" />
            <span>
              <strong>Roger&apos;s Roofing</strong>
              <small>Operations workspace</small>
            </span>
          </Link>
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            aria-label="Close navigation"
          >
            <X size={20} />
          </button>
        </div>

        <div className="admin-org-switcher">
          <span>Active organization</span>
          <label>
            <select
              value={activeOrgId ?? ""}
              onChange={(event) => setActiveOrgId(event.target.value)}
              disabled={membershipLoading}
              aria-label="Active organization"
            >
              {memberships.length === 0 && (
                <option value="">Roger&apos;s Roofing</option>
              )}
              {memberships.map((membership) => (
                <option value={membership.orgId} key={membership.id}>
                  {activeOrgName && membership.orgId === activeOrgId
                    ? activeOrgName
                    : membership.orgId}
                </option>
              ))}
            </select>
            <ChevronDown size={15} />
          </label>
        </div>

        <nav className="admin-sidebar-nav">
          <span className="admin-nav-label">Workspace</span>
          {navigation.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                to={item.to}
                key={item.to}
                onClick={() => setMobileOpen(false)}
                className={({ isActive }) =>
                  isActive ? "admin-nav-item is-active" : "admin-nav-item"
                }
              >
                <Icon size={18} strokeWidth={1.8} />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </nav>

        <div className="admin-sidebar-footer">
          <div className="admin-user-avatar">
            {(employee?.name ?? "R").charAt(0).toUpperCase()}
          </div>
          <div>
            <strong>{employee?.name ?? "Roofing admin"}</strong>
            <span>{employee?.accessRole ?? "administrator"}</span>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            disabled={signingOut}
            aria-label="Sign out"
          >
            <LogOut size={18} />
          </button>
        </div>
      </aside>

      <div className="admin-main">
        <header className="admin-topbar">
          <div className="admin-topbar-title">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              aria-label="Open navigation"
            >
              <Menu size={21} />
            </button>
            <span>Workspace</span>
            <strong>{currentLabel}</strong>
          </div>
          <div className="admin-topbar-actions">
            <Link to="/jobs" className="admin-command-search">
              <Search size={16} />
              <span>Search jobs and records</span>
              <kbd>⌘ K</kbd>
            </Link>
            <Link className="admin-topbar-public" to="/">
              View public site
            </Link>
          </div>
        </header>

        <OrgProvider
          value={{
            orgId: activeOrgId,
            orgName: activeOrgName ?? null,
            memberships,
            setOrgId: setActiveOrgId,
            loading: membershipLoading,
          }}
        >
          <Outlet />
        </OrgProvider>
      </div>
    </div>
  );
}
