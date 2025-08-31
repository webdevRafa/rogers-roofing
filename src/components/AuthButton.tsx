// src/components/AuthButton.tsx
import { useEffect, useState } from "react";
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from "firebase/auth";
import type { User as FirebaseUser } from "firebase/auth";
import { auth } from "../firebase/firebaseConfig";

export default function AuthButton() {
  const [user, setUser] = useState<FirebaseUser | null>(null);

  useEffect(() => {
    return onAuthStateChanged(auth, setUser);
  }, []);

  async function signin() {
    const prov = new GoogleAuthProvider();
    await signInWithPopup(auth, prov);
  }
  async function signout() {
    await signOut(auth);
  }

  if (user) {
    return (
      <div className="flex items-center gap-3">
        <span className="text-xs text-[var(--color-muted)]">
          Hi, {user.displayName || user.email}
        </span>
        <button
          onClick={signout}
          className="rounded-lg border border-[var(--btn-outline-border)] px-3 py-1.5 font-light text-xs text-[var(--btn-outline-text)] hover:bg-[var(--btn-outline-hover-bg)]"
        >
          Sign out
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={signin}
      className="rounded-lg bg-[var(--btn-bg)] text-[var(--btn-text)] px-4 py-2 text-xs hover:bg-[var(--btn-hover-bg)]"
    >
      Sign in with Google
    </button>
  );
}
