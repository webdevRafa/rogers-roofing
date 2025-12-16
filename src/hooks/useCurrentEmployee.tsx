import { useEffect, useState } from "react";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import {
  collection,
  query,
  where,
  getDocs,
  limit,
  onSnapshot,
} from "firebase/firestore";
import { db } from "../firebase/firebaseConfig";
import type { Employee } from "../types/types";

/**
 * useCurrentEmployee fetches the Employee document associated with the
 * currently authenticated Firebase user. It returns the employee record,
 * a loading flag, and any error encountered.
 *
 * On mount, it listens for auth state changes. When a user logs in,
 * it queries the employees collection for a document where `userId`
 * equals the current user's uid. If found, it subscribes to that
 * employee document via onSnapshot to keep the state up to date.
 *
 * If no user is signed in or no employee record exists, employee will
 * be null. Errors during query/subscription are captured in the error
 * state.
 */
export function useCurrentEmployee() {
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const auth = getAuth();
    let unsubEmployee: (() => void) | null = null;
    const unsubAuth = onAuthStateChanged(auth, async (user) => {
      // Cleanup previous employee subscription
      if (unsubEmployee) {
        unsubEmployee();
        unsubEmployee = null;
      }
      if (!user) {
        // no user signed in
        setEmployee(null);
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        // Query the employees collection for the current user's employee doc
        const empQuery = query(
          collection(db, "employees"),
          where("userId", "==", user.uid),
          limit(1)
        );
        const snap = await getDocs(empQuery);
        if (snap.empty) {
          // No employee record yet
          setEmployee(null);
          setLoading(false);
          return;
        }
        const docSnap = snap.docs[0];
        // Subscribe to the employee document to keep updated
        unsubEmployee = onSnapshot(docSnap.ref, (ds) => {
          setEmployee({ id: ds.id, ...(ds.data() as Omit<Employee, "id">) });
          setLoading(false);
        });
      } catch (err: any) {
        setError(err?.message || String(err));
        setEmployee(null);
        setLoading(false);
      }
    });
    // Cleanup on unmount
    return () => {
      unsubAuth();
      if (unsubEmployee) unsubEmployee();
    };
  }, []);

  return { employee, loading, error };
}
