// src/App.tsx
import { BrowserRouter, Routes, Route } from "react-router-dom";
import DashboardPage from "./pages/DashboardPage";
import JobDetailPage from "./pages/JobDetailPage";
import "./index.css";
import InvoiceViewer from "./pages/InvoiceViewer";
import LoginPage from "./pages/LoginPage";
import AdminOnly from "./components/AdminOnly"; // add this import
import EmployeesPage from "./pages/EmployeesPage";
import EmployeeDetailPage from "./pages/EmployeeDetailPage";
import PunchCalendarPage from "./pages/PunchCalendarPage";
import PunchDayPage from "./pages/PunchDayPage";
import ScrollToTop from "./components/ScrollToTop"; // ⬅️ ADD THIS

export default function App() {
  return (
    <>
      <div className="relative z-30 min-h-[1000px] ">
        <BrowserRouter>
          <ScrollToTop />
          <Routes>
            <Route
              path="/dashboard"
              element={
                <AdminOnly>
                  <DashboardPage />
                </AdminOnly>
              }
            />
            {/* Punch calendar */}
            <Route
              path="/schedule"
              element={
                <AdminOnly>
                  <PunchCalendarPage />
                </AdminOnly>
              }
            />
            <Route
              path="/schedule/:date"
              element={
                <AdminOnly>
                  <PunchDayPage />
                </AdminOnly>
              }
            />
            <Route path="/" element={<LoginPage />} />
            <Route path="/job/:id" element={<JobDetailPage />} />
            <Route path="/invoices/:id" element={<InvoiceViewer />} />

            {/* NEW: employees */}
            <Route
              path="/employees"
              element={
                <AdminOnly>
                  <EmployeesPage />
                </AdminOnly>
              }
            />
            <Route
              path="/employees/:id"
              element={
                <AdminOnly>
                  <EmployeeDetailPage />
                </AdminOnly>
              }
            />
          </Routes>
        </BrowserRouter>
      </div>
    </>
  );
}
