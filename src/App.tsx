// src/App.tsx
import { BrowserRouter, Routes, Route } from "react-router-dom";
import JobsPage from "./pages/JobsPage";
import JobDetailPage from "./pages/JobDetailPage";
import "./index.css";
import InvoiceViewer from "./pages/InvoiceViewer";
import roofing from "./assets/roofing.webp";

export default function App() {
  return (
    <>
      <div className="relative z-30">
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<JobsPage />} />
            <Route path="/job/:id" element={<JobDetailPage />} />
            <Route path="/invoices/:id" element={<InvoiceViewer />} />
          </Routes>
        </BrowserRouter>
      </div>
      <div className="absolute top-0 left-0 w-full h-[340px] md:h-[600px] overflow-hidden">
        <div className="w-full h-[100vh]">
          <img
            src={roofing}
            className="object-cover w-full h-full opacity-15  z-[-1] "
            alt=""
          />
        </div>
      </div>
    </>
  );
}
