import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { createUserWithEmailAndPassword } from "firebase/auth";
import { getFunctions, httpsCallable } from "firebase/functions";

import { auth, db } from "../firebase/firebaseConfig";

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

  async function handleCreateAccount() {
    if (!inviteId) return;
    setErr(null);

    const email = String(invite?.email || "")
      .trim()
      .toLowerCase();
    if (!email) {
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
      await createUserWithEmailAndPassword(auth, email, password);

      // 2) Claim invite (requires auth, which we now have)
      const functions = getFunctions();
      const claimInvite = httpsCallable(functions, "claimEmployeeInvite");
      await claimInvite({ inviteId });

      // 3) Done
      navigate("/dashboard", { replace: true });
    } catch (e: any) {
      const code = e?.code || "";
      if (code === "auth/email-already-in-use") {
        setErr(
          "That email already has an account. Click “Sign in instead” below."
        );
      } else {
        setErr(e?.message || "Signup failed. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <div className="p-6">Loading…</div>;
  if (err) return <div className="p-6 text-red-600">{err}</div>;
  if (!invite) return null;

  const email = String(invite.email || "");

  return (
    <div className="mx-auto mt-10 max-w-md rounded-xl bg-white p-6 shadow">
      <h1 className="text-xl font-semibold">Finish creating your account</h1>
      <p className="mt-2 text-sm text-neutral-600">
        You’ve been invited as <span className="font-medium">{email}</span>.
        Create a password to activate your account.
      </p>

      <div className="mt-5 space-y-3">
        <div>
          <label className="text-xs uppercase tracking-wide text-neutral-500">
            Email (locked)
          </label>
          <input
            value={email}
            disabled
            className="mt-1 w-full rounded-lg border bg-neutral-100 px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="text-xs uppercase tracking-wide text-neutral-500">
            Password
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
            placeholder="Create a password"
          />
        </div>

        <div>
          <label className="text-xs uppercase tracking-wide text-neutral-500">
            Confirm password
          </label>
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
            placeholder="Confirm password"
          />
        </div>

        {err && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-700">
            {err}
          </div>
        )}

        <button
          onClick={handleCreateAccount}
          disabled={submitting}
          className="w-full rounded-lg bg-black px-4 py-2 text-sm text-white disabled:opacity-60"
        >
          {submitting ? "Creating…" : "Create account & accept invite"}
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
          className="w-full rounded-lg border px-4 py-2 text-sm"
        >
          Sign in instead
        </button>
      </div>
    </div>
  );
}
