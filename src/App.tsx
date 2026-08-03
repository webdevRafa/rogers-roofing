// src/App.tsx
import { BrowserRouter, Navigate, Routes, Route } from "react-router-dom";
import "./index.css";

import LoginPage from "./pages/LoginPage";
import PublicHomePage from "./pages/PublicHomePage";
// Use our new role-based guards
import AdminGuard from "../src/components/AdminGuard";
import RoleGuard from "../src/components/RoleGuard";
import CrewLayout from "../src/layouts/CrewLayout";
import CrewDashboardPage from "../src/pages/CrewDashboardPage";
import CrewJobDetailPage from "../src/pages/CrewJobDetailPage";
import ScrollToTop from "./components/ScrollToTop";
import JobsPage from "./pages/JobsPage";
import AdminLayout from "./layouts/AdminLayout";
import FinancialOverviewPage from "./pages/FinancialOverviewPage";
import AdminOverviewPage from "./pages/AdminOverviewPage";
import EmployeesPage from "./pages/EmployeesPage";
import EmployeeDetailPage from "./pages/EmployeeDetailPage";
import PunchCalendarPage from "./pages/PunchCalendarPage";
import PunchDayPage from "./pages/PunchDayPage";
import JobDetailPage from "./pages/JobDetailPage";
import InvoiceViewer from "./pages/InvoiceViewer";
import AcceptInvitePage from "./pages/AcceptInvitePage";
import CompleteSignupPage from "./pages/CompleteSignupPage";
import InvoicesPage from "./pages/InvoicesPage";
import LeadsPage from "./pages/LeadsPage";
import MaterialsPage from "./pages/MaterialsPage";
import PayoutsPage from "./pages/PayoutsPage";
import JobWorkspacePage from "./pages/JobWorkspacePage";
import WarrantyPreviewPage from "./pages/WarrantyPreviewPage";
import EstimateBuilderPage from "./pages/EstimateBuilderPage";
import EstimateViewer from "./pages/EstimateViewer";

export default function App() {
  return (
    <div>
      <BrowserRouter>
        <ScrollToTop />
        <Routes>
          <Route path="/" element={<PublicHomePage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/accept-invite" element={<AcceptInvitePage />} />
          <Route path="/complete-signup" element={<CompleteSignupPage />} />
          <Route path="/invoice/:id" element={<InvoiceViewer />} />
          <Route path="/estimate/:id" element={<EstimateViewer />} />

          {/* ✅ Admin routes protected by AdminGuard */}
          <Route
            element={
              <AdminGuard>
                <AdminLayout />
              </AdminGuard>
            }
          >
            <Route path="/admin" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<AdminOverviewPage />} />
            <Route path="/invoices-page" element={<InvoicesPage />} />
            <Route
              path="/financial-overview"
              element={<FinancialOverviewPage />}
            />
            <Route path="/schedule" element={<PunchCalendarPage />} />
            <Route path="/jobs" element={<JobsPage />} />
            <Route path="/leads" element={<LeadsPage />} />
            <Route path="/materials" element={<MaterialsPage />} />
            <Route path="/payouts" element={<PayoutsPage />} />
            <Route path="/schedule/:date" element={<PunchDayPage />} />
            <Route path="/employees" element={<EmployeesPage />} />
            <Route path="/employees/:id" element={<EmployeeDetailPage />} />
            <Route path="/job/:id" element={<JobWorkspacePage />} />
            <Route
              path="/job/:id/warranty-preview"
              element={<WarrantyPreviewPage />}
            />
            <Route path="/legacy-job/:id" element={<JobDetailPage />} />
            <Route path="/invoices/:id" element={<InvoiceViewer />} />
            <Route path="/estimates/new" element={<EstimateBuilderPage />} />
            <Route
              path="/estimates/:id/edit"
              element={<EstimateBuilderPage />}
            />
          </Route>

          {/* ✅ Crew routes accessible to crew, manager, readOnly roles */}
          <Route
            element={
              <RoleGuard allowedRoles={["crew", "manager", "readOnly"]}>
                <CrewLayout />
              </RoleGuard>
            }
          >
            <Route path="/crew" element={<CrewDashboardPage />} />
            <Route path="/crew/job/:id" element={<CrewJobDetailPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </div>
  );
}
