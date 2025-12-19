// src/App.tsx
import { BrowserRouter, Routes, Route } from "react-router-dom";
import "./index.css";

import LoginPage from "./pages/LoginPage";
// Use our new role-based guards
import AdminGuard from "../src/components/AdminGuard";
import RoleGuard from "../src/components/RoleGuard";
import CrewLayout from "../src/layouts/CrewLayout";
import CrewDashboardPage from "../src/pages/CrewDashboardPage";
import CrewJobDetailPage from "../src/pages/CrewJobDetailPage";
import ScrollToTop from "./components/ScrollToTop";

import AdminLayout from "./layouts/AdminLayout";

import DashboardPage from "./pages/DashboardPage";
import EmployeesPage from "./pages/EmployeesPage";
import EmployeeDetailPage from "./pages/EmployeeDetailPage";
import PunchCalendarPage from "./pages/PunchCalendarPage";
import PunchDayPage from "./pages/PunchDayPage";
import JobDetailPage from "./pages/JobDetailPage";
import InvoiceViewer from "./pages/InvoiceViewer";
import AcceptInvitePage from "./pages/AcceptInvitePage";
import CompleteSignupPage from "./pages/CompleteSignupPage";

export default function App() {
  return (
    <div className="relative z-30 ">
      <BrowserRouter>
        <ScrollToTop />
        <Routes>
          <Route path="/" element={<LoginPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/accept-invite" element={<AcceptInvitePage />} />
          <Route path="/complete-signup" element={<CompleteSignupPage />} />

          {/* ✅ Admin routes protected by AdminGuard */}
          <Route
            element={
              <AdminGuard>
                <AdminLayout />
              </AdminGuard>
            }
          >
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/schedule" element={<PunchCalendarPage />} />
            <Route path="/schedule/:date" element={<PunchDayPage />} />
            <Route path="/employees" element={<EmployeesPage />} />
            <Route path="/employees/:id" element={<EmployeeDetailPage />} />
            <Route path="/job/:id" element={<JobDetailPage />} />
            <Route path="/invoices/:id" element={<InvoiceViewer />} />
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
