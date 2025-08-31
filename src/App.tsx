// src/App.tsx
import { BrowserRouter, Routes, Route } from "react-router-dom";
import JobsPage from "./pages/JobsPage";
import JobDetailPage from "./pages/JobDetailPage";
import "./index.css";
import logo from "../src/assets/rogers-roofing.webp";
import AuthButton from "../src/components/AuthButton";

export default function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-[var(--color-background)]">
        <nav className="sticky top-0 z-10 border-b border-[var(--color-border)] bg-[var(--color-card)]/80 backdrop-blur">
          <div className="mx-auto w-[min(1100px,92vw)] flex items-center justify-between py-3">
            <div className="text-lg font-poppins font-bold  text-[var(--color-text)] flex justify-between w-full items-center">
              Roger's Roofing
              <AuthButton />
              <img className="max-w-[80px]" src={logo} alt="" />
            </div>
          </div>
        </nav>
        <Routes>
          <Route path="/" element={<JobsPage />} />
          <Route path="/job/:id" element={<JobDetailPage />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}
