import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import { getAuth } from "firebase/auth";
import { db } from "../firebase/firebaseConfig";

/**
 * AcceptInvitePage handles the user‑facing flow for accepting an employee
 * invitation. It reads the invite document based on the `inviteId` query
 * parameter, displays basic info, and provides a button to claim the invite
 * via the claimEmployeeInvite callable function.  This version adds a check
 * to ensure that the currently authenticated user's email matches the
 * invite's email.  If the user is logged in as someone else, they will
 * be signed out and redirected to log in with the invited email.
 */
export default function AcceptInvitePage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const inviteId = searchParams.get("inviteId") || "";
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [invite, setInvite] = useState<any | null>(null);
  const [claiming, setClaiming] = useState(false);

  // Fetch the invite document on mount
  useEffect(() => {
    async function fetchInvite() {
      if (!inviteId) {
        setError("Missing inviteId parameter.");
        setLoading(false);
        return;
      }
      try {
        const ref = doc(db, "employeeInvites", inviteId);
        const snap = await getDoc(ref);
        if (!snap.exists()) {
          setError("Invite not found or has been deleted.");
        } else {
          const data = snap.data();
          setInvite({ id: snap.id, ...data });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
      } finally {
        setLoading(false);
      }
    }
    fetchInvite();
  }, [inviteId]);

  // Call the claimEmployeeInvite callable function
  async function handleClaim() {
    if (!inviteId) return;
    const auth = getAuth();
    const currentUser = auth.currentUser;
    // If no user logged in, redirect to complete‑signup
    if (!currentUser) {
      navigate(`/complete-signup?inviteId=${encodeURIComponent(inviteId)}`);
      return;
    }
    const inviteEmail = String(invite?.email || "")
      .trim()
      .toLowerCase();
    const userEmail = String(currentUser.email || "")
      .trim()
      .toLowerCase();
    if (inviteEmail && userEmail && inviteEmail !== userEmail) {
      // The signed‑in user does not match the invite email.
      // Sign them out and redirect to login with redirect back to accept-invite.
      await auth.signOut();
      setError(
        `You are signed in as ${userEmail}, but this invite is for ${inviteEmail}. Please sign in with the invited email to accept the invite.`
      );
      navigate(
        `/login?redirect=${encodeURIComponent(
          `/accept-invite?inviteId=${inviteId}`
        )}`
      );
      return;
    }
    try {
      setClaiming(true);
      setError(null);
      const functions = getFunctions();
      const claimInvite = httpsCallable(functions, "claimEmployeeInvite");
      await claimInvite({ inviteId });
      navigate("/dashboard");
    } catch (err: any) {
      const msg = err?.message || String(err);
      setError(msg);
    } finally {
      setClaiming(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-md mt-10 p-4">
        <p className="text-center text-sm">Loading invite…</p>
      </div>
    );
  }
  if (error) {
    return (
      <div className="mx-auto max-w-md mt-10 p-4">
        <p className="text-center text-sm text-red-600">{error}</p>
      </div>
    );
  }
  if (!invite) {
    return null;
  }
  return (
    <div className="mx-auto max-w-md mt-10 p-4">
      <h1 className="text-xl font-semibold mb-4">Accept Invitation</h1>
      <p className="mb-4 text-sm">
        You have been invited to join the team. Click the button below to accept
        your invitation. You may need to sign in or create an account after
        clicking.
      </p>
      <div className="mb-4">
        <div className="text-sm">
          <strong>Invite ID:</strong> {invite.id}
        </div>
        <div className="text-sm">
          <strong>Email:</strong> {invite.email}
        </div>
        <div className="text-sm">
          <strong>Status:</strong> {invite.status}
        </div>
      </div>
      <button
        onClick={handleClaim}
        disabled={claiming}
        className="rounded-md bg-[var(--color-logo)] text-white px-4 py-2 text-sm hover:opacity-90 disabled:opacity-50"
      >
        {claiming ? "Processing…" : "Continue"}
      </button>
    </div>
  );
}
