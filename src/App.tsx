// src/App.tsx
import { BrowserRouter, Routes, Route } from "react-router-dom";
import JobsPage from "./pages/JobsPage";
import JobDetailPage from "./pages/JobDetailPage";
import "./index.css";
import InvoiceViewer from "./pages/InvoiceViewer";
import LoginPage from "./pages/LoginPage";
import AdminOnly from "./components/AdminOnly"; // add this import
import EmployeesPage from "./pages/EmployeesPage";
import EmployeeDetailPage from "./pages/EmployeeDetailPage";
import PunchCalendarPage from "./pages/PunchCalendarPage";
import PunchDayPage from "./pages/PunchDayPage";

export default function App() {
  return (
    <>
      <div className="relative z-30 min-h-[1000px] ">
        <BrowserRouter>
          <Routes>
            <Route
              path="/jobs"
              element={
                <AdminOnly>
                  <JobsPage />
                </AdminOnly>
              }
            />
            {/* Punch calendar */}
            <Route
              path="/punches"
              element={
                <AdminOnly>
                  <PunchCalendarPage />
                </AdminOnly>
              }
            />
            <Route
              path="/punches/:date"
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
