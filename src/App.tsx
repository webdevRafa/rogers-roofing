// src/App.tsx
import { BrowserRouter, Routes, Route } from "react-router-dom";
import JobsPage from "./pages/JobsPage";
import JobDetailPage from "./pages/JobDetailPage";
import "./index.css";
import InvoiceViewer from "./pages/InvoiceViewer";
import LoginPage from "./pages/LoginPage";
import AdminOnly from "./components/AdminOnly"; // add this import

export default function App() {
  return (
    <>
      <div className="relative z-30">
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
            <Route path="/" element={<LoginPage />} />
            <Route path="/job/:id" element={<JobDetailPage />} />
            <Route path="/invoices/:id" element={<InvoiceViewer />} />
          </Routes>
        </BrowserRouter>
      </div>
    </>
  );
}
