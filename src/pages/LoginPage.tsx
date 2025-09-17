// src/pages/LoginPage.tsx
import { useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import roofing from "../assets/roofing.webp";
import logo from "../assets/rogers-roofing.webp";

// Assumes you export `auth` from ../firebase/firebaseConfig
import { auth } from "../firebase/firebaseConfig";
import { signInWithEmailAndPassword } from "firebase/auth";

const LoginPage = () => {
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleEmailLogin(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr(null);
    setSubmitting(true);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
      // ✅ redirect on success
      navigate("/jobs", { replace: true });
    } catch (error: any) {
      const msg =
        error?.code === "auth/invalid-credential"
          ? "Invalid email or password."
          : error?.message || "Login failed. Please try again.";
      setErr(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <div className="w-full h-[100vh] flex items-center justify-center relative px-4 bg-amber-50/50">
        {/* login box */}
        <div className="bg-[var(--color-card)] shadow-md w-full max-w-[380px] pb-6 rounded-2xl border-2 border-white">
          <img
            className="max-w-[200px] mx-auto mb-0"
            src={logo}
            alt="Rogers Roofing"
          />
          <h1 className="text-center mt-0 mb-4 tracking-wide uppercase text-lg opacity-80 font-poppin">
            admin login
          </h1>

          {/* Error */}
          {err && (
            <div className="mx-5 mb-3 rounded-lg border border-red-500/30 bg-red-500/10 text-red-300 px-3 py-2 text-sm">
              {err}
            </div>
          )}

          {/* Email / Password */}
          <form onSubmit={handleEmailLogin} className="px-5 space-y-3">
            <div className="space-y-1.5">
              <label
                htmlFor="email"
                className="text-xs uppercase tracking-wide opacity-70"
              >
                Email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg bg-neutral-100 border border-white/10 px-3 py-2 outline-none focus:border-white/30"
                placeholder="you@example.com"
              />
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="password"
                className="text-xs uppercase tracking-wide opacity-70"
              >
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg bg-neutral-100 border border-white/10 px-3 py-2 outline-none focus:border-white/30"
                placeholder="••••••••"
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full mt-2 rounded-lg px-4 py-2.5 font-medium bg-[var(--color-logo)] text-white hover:bg-[var(--color-primary)] transition disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {submitting ? "Signing in…" : "Sign in"}
            </button>
          </form>
        </div>

        {/* Background image */}
        <div className="w-full h-[50vh] absolute top-0 left-0 z-[-1] overflow-hidden blur-xs opacity-50">
          <img
            className="w-full h-full object-cover"
            src={roofing}
            alt="Roofing"
          />
        </div>
      </div>
    </>
  );
};

export default LoginPage;
