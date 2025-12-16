import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { createUserWithEmailAndPassword } from "firebase/auth";
import { getFunctions, httpsCallable } from "firebase/functions";
import { Eye, EyeOff, ShieldCheck, Mail, ArrowRight } from "lucide-react";

import { auth, db } from "../firebase/firebaseConfig";
import { collection, query, where, getDocs, limit } from "firebase/firestore";

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function passwordScore(pw: string) {
  let score = 0;
  if (pw.length >= 8) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  return score; // 0..4
}

export default function CompleteSignupPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const inviteId = searchParams.get("inviteId") || "";

  const [loading, setLoading] = useState(true);
  const [invite, setInvite] = useState<any | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [showPw, setShowPw] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  useEffect(() => {
    async function loadInvite() {
      if (!inviteId) {
        setErr("Missing inviteId.");
        setLoading(false);
        return;
      }
      try {
        const ref = doc(db, "employeeInvites", inviteId);
        const snap = await getDoc(ref);
        if (!snap.exists()) {
          setErr("Invite not found.");
        } else {
          setInvite({ id: snap.id, ...snap.data() });
        }
      } catch (e: any) {
        setErr(e?.message || String(e));
      } finally {
        setLoading(false);
      }
    }
    loadInvite();
  }, [inviteId]);

  const email = useMemo(() => String(invite?.email || ""), [invite]);
  const score = useMemo(() => passwordScore(password), [password]);

  async function handleCreateAccount() {
    if (!inviteId) return;
    setErr(null);

    const inviteEmail = String(invite?.email || "")
      .trim()
      .toLowerCase();
    if (!inviteEmail) {
      setErr("Invite is missing an email.");
      return;
    }
    if (password.length < 6) {
      setErr("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirm) {
      setErr("Passwords do not match.");
      return;
    }

    try {
      setSubmitting(true);

      // 1) Create Firebase Auth user
      await createUserWithEmailAndPassword(auth, inviteEmail, password);

      // 2) Claim invite (requires auth, which we now have)
      const functions = getFunctions();
      const claimInvite = httpsCallable(functions, "claimEmployeeInvite");
      await claimInvite({ inviteId });

      // 3) After claiming, fetch employee to determine role and redirect
      let accessRole: string | undefined;
      try {
        const user = auth.currentUser;
        if (user) {
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
        }
      } catch (e) {
        console.error("Failed to fetch employee record", e);
      }
      // Navigate based on role
      if (accessRole === "admin" || accessRole === "manager") {
        navigate("/dashboard", { replace: true });
      } else {
        navigate("/crew", { replace: true });
      }
    } catch (e: any) {
      const code = e?.code || "";
      if (code === "auth/email-already-in-use") {
        setErr("That email already has an account. Use “Sign in instead”.");
      } else {
        setErr(e?.message || "Signup failed. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--color-bg)] p-6">
        <div className="mx-auto max-w-md rounded-2xl border border-white/10 bg-white/70 p-6 shadow">
          Loading invite…
        </div>
      </div>
    );
  }

  if (err && !invite) {
    return (
      <div className="min-h-screen bg-[var(--color-bg)] p-6">
        <div className="mx-auto max-w-md rounded-2xl border border-red-500/30 bg-red-500/10 p-6 text-red-700 shadow">
          {err}
        </div>
      </div>
    );
  }

  if (!invite) return null;

  return (
    <div className="relative min-h-screen overflow-hidden bg-[var(--color-bg)]">
      {/* Soft background wash */}
      <div className="pointer-events-none absolute inset-0 opacity-70">
        <div className="absolute -top-32 left-1/2 h-80 w-[36rem] -translate-x-1/2 rounded-full bg-[var(--color-logo)] blur-3xl opacity-20" />
        <div className="absolute -bottom-32 left-1/3 h-80 w-[32rem] -translate-x-1/2 rounded-full bg-black blur-3xl opacity-10" />
      </div>

      <div className="relative mx-auto flex min-h-screen max-w-6xl items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          {/* Header */}
          <div className="mb-6 text-center">
            <div className="mx-auto mb-3 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/60 px-3 py-1 text-xs text-neutral-700 shadow-sm">
              <ShieldCheck className="h-4 w-4" />
              Step 2 of 2 • Accept invite
            </div>

            <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">
              Finish creating your account
            </h1>
            <p className="mt-2 text-sm text-neutral-600">
              You’ve been invited to join the team. Create a password to
              activate your account.
            </p>
          </div>

          {/* Card */}
          <div className="rounded-2xl border border-white/10 bg-white/70 p-6 shadow-xl backdrop-blur">
            {/* Invite email */}
            <div className="mb-5 rounded-xl border border-white/10 bg-white/60 p-3">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 rounded-lg bg-black/5 p-2">
                  <Mail className="h-4 w-4 text-neutral-700" />
                </div>
                <div className="min-w-0">
                  <div className="text-xs uppercase tracking-wide text-neutral-500">
                    Invited email (locked)
                  </div>
                  <div className="truncate text-sm font-medium text-neutral-900">
                    {email}
                  </div>
                </div>
              </div>
            </div>

            {/* Password */}
            <div className="space-y-4">
              <div>
                <label className="text-xs font-medium uppercase tracking-wide text-neutral-600">
                  Password
                </label>
                <div className="relative mt-1">
                  <input
                    type={showPw ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 pr-10 text-sm outline-none ring-0 placeholder:text-neutral-400 focus:border-black/20 focus:shadow-[0_0_0_4px_rgba(0,0,0,0.06)]"
                    placeholder="Create a password"
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-2 text-neutral-600 hover:bg-black/5"
                    aria-label={showPw ? "Hide password" : "Show password"}
                  >
                    {showPw ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>

                {/* Strength meter */}
                <div className="mt-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-neutral-500">
                      Password strength
                    </span>
                    <span className="text-xs text-neutral-600">
                      {score <= 1
                        ? "Weak"
                        : score === 2
                        ? "Fair"
                        : score === 3
                        ? "Good"
                        : "Strong"}
                    </span>
                  </div>
                  <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-black/5">
                    <div
                      className={cx(
                        "h-full rounded-full transition-all",
                        score === 0 && "w-[5%] bg-red-500/50",
                        score === 1 && "w-[25%] bg-red-500/60",
                        score === 2 && "w-[50%] bg-amber-500/70",
                        score === 3 && "w-[75%] bg-emerald-500/60",
                        score === 4 && "w-[100%] bg-emerald-500/80"
                      )}
                    />
                  </div>

                  <ul className="mt-2 grid grid-cols-2 gap-2 text-xs text-neutral-500">
                    <li
                      className={cx(password.length >= 8 && "text-neutral-800")}
                    >
                      • 8+ characters
                    </li>
                    <li
                      className={cx(
                        /[A-Z]/.test(password) && "text-neutral-800"
                      )}
                    >
                      • 1 uppercase
                    </li>
                    <li
                      className={cx(
                        /[0-9]/.test(password) && "text-neutral-800"
                      )}
                    >
                      • 1 number
                    </li>
                    <li
                      className={cx(
                        /[^A-Za-z0-9]/.test(password) && "text-neutral-800"
                      )}
                    >
                      • 1 symbol
                    </li>
                  </ul>
                </div>
              </div>

              {/* Confirm */}
              <div>
                <label className="text-xs font-medium uppercase tracking-wide text-neutral-600">
                  Confirm password
                </label>
                <div className="relative mt-1">
                  <input
                    type={showConfirm ? "text" : "password"}
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 pr-10 text-sm outline-none ring-0 placeholder:text-neutral-400 focus:border-black/20 focus:shadow-[0_0_0_4px_rgba(0,0,0,0.06)]"
                    placeholder="Confirm password"
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirm((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-2 text-neutral-600 hover:bg-black/5"
                    aria-label={showConfirm ? "Hide password" : "Show password"}
                  >
                    {showConfirm ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>

                {confirm.length > 0 && confirm !== password && (
                  <p className="mt-2 text-xs text-red-700">
                    Passwords don’t match.
                  </p>
                )}
              </div>

              {/* Errors */}
              {err && (
                <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-700">
                  {err}
                </div>
              )}

              {/* Actions */}
              <button
                onClick={handleCreateAccount}
                disabled={
                  submitting ||
                  !password ||
                  !confirm ||
                  password !== confirm ||
                  password.length < 6
                }
                className="group inline-flex w-full items-center justify-center gap-2 rounded-xl bg-black px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:opacity-95 disabled:opacity-50"
              >
                {submitting ? "Creating…" : "Create account & accept invite"}
                <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
              </button>

              <button
                type="button"
                onClick={() =>
                  navigate(
                    `/login?redirect=${encodeURIComponent(
                      `/accept-invite?inviteId=${inviteId}`
                    )}`
                  )
                }
                className="w-full rounded-xl border border-black/10 bg-white px-4 py-2.5 text-sm font-medium text-neutral-900 transition hover:bg-black/5"
              >
                Sign in instead
              </button>

              <p className="pt-2 text-center text-xs text-neutral-500">
                By continuing, you’re joining this contractor’s team in Roger’s
                Roofing.
              </p>
            </div>
          </div>

          {/* Footer note */}
          <div className="mt-6 text-center text-xs text-neutral-500">
            Having trouble? Ask the contractor to resend the invite or verify
            the email.
          </div>
        </div>
      </div>
    </div>
  );
}
