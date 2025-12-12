// src/App.tsx
import { BrowserRouter, Routes, Route } from "react-router-dom";
import "./index.css";

import LoginPage from "./pages/LoginPage";
import AdminOnly from "./components/AdminOnly";
import ScrollToTop from "./components/ScrollToTop";

import AdminLayout from "./layouts/AdminLayout";

import DashboardPage from "./pages/DashboardPage";
import EmployeesPage from "./pages/EmployeesPage";
import EmployeeDetailPage from "./pages/EmployeeDetailPage";
import PunchCalendarPage from "./pages/PunchCalendarPage";
import PunchDayPage from "./pages/PunchDayPage";
import JobDetailPage from "./pages/JobDetailPage";
import InvoiceViewer from "./pages/InvoiceViewer";

export default function App() {
  return (
    <div className="relative z-30 min-h-[1000px]">
      <BrowserRouter>
        <ScrollToTop />
        <Routes>
          <Route path="/" element={<LoginPage />} />

          {/* ✅ Everything below gets the global navbar */}
          <Route
            element={
              <AdminOnly>
                <AdminLayout />
              </AdminOnly>
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
        </Routes>
      </BrowserRouter>
    </div>
  );
}
