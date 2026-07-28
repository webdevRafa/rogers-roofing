import { useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { signInWithEmailAndPassword } from "firebase/auth";
import { collection, getDocs, limit, query, where } from "firebase/firestore";
import {
  ArrowLeft,
  ArrowRight,
  Eye,
  EyeOff,
  LockKeyhole,
  ShieldCheck,
} from "lucide-react";

import { auth, db } from "../firebase/firebaseConfig";
import logo from "../assets/rogers-roofing.webp";
import worksite from "../assets/AdobeStock_356783144.webp";

type EmployeeAccess = {
  accessRole?: string;
};

function messageFromError(error: unknown): string {
  const code =
    typeof error === "object" && error && "code" in error
      ? String(error.code)
      : "";
  if (code === "auth/invalid-credential") return "Invalid email or password.";
  if (code === "auth/too-many-requests") {
    return "Too many attempts. Please wait a moment and try again.";
  }
  return "We could not sign you in. Check your details and try again.";
}

export default function LoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirect = searchParams.get("redirect");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleEmailLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const credential = await signInWithEmailAndPassword(
        auth,
        email.trim(),
        password
      );
      const employeeQuery = query(
        collection(db, "employees"),
        where("userId", "==", credential.user.uid),
        limit(1)
      );
      const employeeSnapshot = await getDocs(employeeQuery);
      const employee = employeeSnapshot.empty
        ? null
        : (employeeSnapshot.docs[0].data() as EmployeeAccess);

      if (redirect) {
        navigate(redirect, { replace: true });
      } else if (
        employee?.accessRole === "admin" ||
        employee?.accessRole === "manager"
      ) {
        navigate("/dashboard", { replace: true });
      } else {
        navigate("/crew", { replace: true });
      }
    } catch (caught) {
      setError(messageFromError(caught));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-visual">
        <img src={worksite} alt="Aerial view of a roofing installation" />
        <div className="login-visual-shade" />
        <Link className="login-back-link" to="/">
          <ArrowLeft size={16} />
          Back to public website
        </Link>
        <div className="login-visual-copy">
          <span>Roger&apos;s Roofing operations</span>
          <h1>Every project detail, under one roof.</h1>
          <p>
            Manage leads, jobs, materials, crews, payouts, estimates, invoices,
            and warranty closeout from one secure workspace.
          </p>
          <div>
            <ShieldCheck size={18} />
            Authorized team members only
          </div>
        </div>
      </section>

      <section className="login-panel">
        <div className="login-form-wrap">
          <div className="login-brand">
            <img src={logo} alt="Roger's Roofing & Contracting LLC" />
            <div>
              <strong>Roger&apos;s Roofing</strong>
              <span>&amp; Contracting LLC</span>
            </div>
          </div>

          <div className="login-heading">
            <span>Admin workspace</span>
            <h2>Welcome back.</h2>
            <p>Sign in with the account provided by your administrator.</p>
          </div>

          <form onSubmit={handleEmailLogin}>
            <label>
              Email address
              <input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="name@company.com"
              />
            </label>

            <label>
              Password
              <span className="login-password-field">
                <input
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Enter your password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </span>
            </label>

            {error && (
              <div className="login-error" role="alert">
                {error}
              </div>
            )}

            <button className="login-submit" type="submit" disabled={submitting}>
              <LockKeyhole size={17} />
              {submitting ? "Signing in…" : "Sign in to workspace"}
              {!submitting && <ArrowRight size={17} />}
            </button>
          </form>

          <p className="login-help">
            Need access? Ask an owner or administrator to invite you as a team
            member.
          </p>
        </div>
      </section>
    </main>
  );
}
