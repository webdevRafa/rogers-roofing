// src/pages/LoginPage.tsx
import { useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import roofing from "../assets/roofing.webp";
import logo from "../assets/rogers-roofing.webp";
import { Eye, EyeOff } from "lucide-react";

// Assumes you export `auth` from ../firebase/firebaseConfig
import { auth } from "../firebase/firebaseConfig";
import { signInWithEmailAndPassword } from "firebase/auth";

const LoginPage = () => {
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

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
      <div className="w-full h-[100vh] flex items-center justify-center relative px-4 ">
        {/* login box */}
        <div className="bg-[var(--color-card)] shadow-md w-full max-w-[380px] pb-6  border-2 border-white">
          <img
            className="max-w-[200px] mx-auto mb-0"
            src={logo}
            alt="Rogers Roofing"
          />

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

              {/* Wrapper so we can position the eye icon inside the input */}
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-lg bg-neutral-100 border border-white/10 px-3 py-2 pr-10 outline-none focus:border-white/30"
                  placeholder="••••••••"
                />

                {/* Eye toggle button */}
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute inset-y-0 right-0 flex items-center pr-3 text-neutral-500 hover:text-neutral-800 focus:outline-none"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full mt-2 rounded-lg px-4 py-2.5 text-xs bg-[var(--color-logo)] text-white hover:bg-[var(--color-primary)] transition disabled:opacity-60 disabled:cursor-not-allowed"
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
