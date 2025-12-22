// src/pages/LoginPage.tsx
import { useState } from "react";
import type { FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import roofing from "../assets/roofing.webp";
import logo from "../assets/rogers-roofing-logo-hero.png";
import { Eye, EyeOff } from "lucide-react";

// Assumes you export `auth` from ../firebase/firebaseConfig
import { auth } from "../firebase/firebaseConfig";
import { signInWithEmailAndPassword } from "firebase/auth";
import { collection, query, where, getDocs, limit } from "firebase/firestore";
import { db } from "../firebase/firebaseConfig";

const LoginPage = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirect = searchParams.get("redirect");

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
      const cred = await signInWithEmailAndPassword(
        auth,
        email.trim(),
        password
      );
      const user = cred.user;

      // Fetch employee record to determine access role
      let accessRole: string | undefined;
      try {
        const q = query(
          collection(db, "employees"),
          where("userId", "==", user.uid),
          limit(1)
        );
        const snap = await getDocs(q);
        if (!snap.empty) {
          const data: any = snap.docs[0].data();
          accessRole = data.accessRole;
        }
      } catch (e) {
        // ignore errors and fall back to default
        console.error("Failed to fetch employee record", e);
      }

      // ✅ redirect back to invite or to proper dashboard based on role
      if (redirect) {
        navigate(redirect, { replace: true });
      } else if (accessRole === "admin" || accessRole === "manager") {
        navigate("/dashboard", { replace: true });
      } else {
        navigate("/crew", { replace: true });
      }
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
      <div className="w-full h-[100vh] flex items-center justify-center relative px-4 bg-gradient-to-tr from-[var(--color-logo)]/99 via-[var(--color-brown)]/95 to-[var(--color-logo)]/80">
        {/* login box */}
        <div className="bg-white w-full max-w-[380px] md:max-w-[600px] pb-6  border-2 border-[var(--color-brown)] select-none flex flex-col md:flex-row items-center">
          <div>
            <img
              className="max-h-[300px] mx-auto  mb-0 bg-white  "
              src={logo}
              alt="Rogers Roofing"
            />

            {/* Error */}
            {err && (
              <div className="mx-5 mb-3 rounded-lg border border-red-500/30 bg-red-500/10 text-red-300 px-3 py-2 text-sm">
                {err}
              </div>
            )}
          </div>

          {/* Email / Password */}
          <form onSubmit={handleEmailLogin} className="px-5 space-y-3">
            <div className="space-y-1.5">
              <label
                htmlFor="email"
                className="text-xs uppercase tracking-wide "
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
                className="w-full rounded-lg bg-neutral-100/60 border border-white/10 px-3 py-2 outline-none focus:border-white/30"
                placeholder="you@example.com"
              />
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="password"
                className="text-xs uppercase tracking-wide "
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
                  className="w-full rounded-lg bg-neutral-100/60 border border-white/10 px-3 py-2 pr-10 outline-none focus:border-white/30"
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
              className="mt-2 mx-auto select-none cursor-pointer hover:scale-105 hover:drop-shadow-lg  rounded-xs block px-4 py-2.5 text-xs bg-[var(--color-brown)] text-white hover:bg-[var(--color-brown-hover)] transition duration-300 ease-in-out disabled:opacity-80 disabled:cursor-not-allowed"
            >
              {submitting ? "Signing in…" : "Sign in"}
            </button>
          </form>
        </div>

        {/* Background image */}
        <div className="w-full  h-[60vh] md:h-[100vh] absolute top-0 left-0 z-[-1] overflow-hidden blur-[5px] opacity-50">
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
