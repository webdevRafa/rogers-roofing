import { useEffect, useMemo, useState } from "react";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import {
  collection,
  onSnapshot,
  query,
  where,
  documentId,
} from "firebase/firestore";
import { db } from "../firebase/firebaseConfig";
import type { Address } from "../types/types";

export type MembershipDoc = {
  id: string;
  orgId: string;
  role?: string;
  status?: string; // "active"
  userId: string;
};

type OrgDoc = {
  id: string;
  name?: string;
  legalName?: string;
  logoUrl?: string | null;
  phone?: string;
  email?: string;
  address?: Address | null;
};

const LS_KEY = "rr_activeOrgId";

export function useMembership() {
  const [memberships, setMemberships] = useState<MembershipDoc[]>([]);
  const [orgsById, setOrgsById] = useState<Record<string, OrgDoc>>({});
  const [activeOrgId, setActiveOrgIdState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Setter that also persists
  function setActiveOrgId(nextOrgId: string) {
    localStorage.setItem(LS_KEY, nextOrgId);
    setActiveOrgIdState(nextOrgId);
  }

  // 1) Load memberships for current user
  useEffect(() => {
    const auth = getAuth();

    const unsubAuth = onAuthStateChanged(auth, (user) => {
      setMemberships([]);
      setOrgsById({});
      setActiveOrgIdState(null);

      if (!user) {
        setLoading(false);
        return;
      }

      setLoading(true);

      const q = query(
        collection(db, "memberships"),
        where("userId", "==", user.uid),
        where("status", "==", "active")
      );

      const unsubMemberships = onSnapshot(
        q,
        (snap) => {
          const list: MembershipDoc[] = snap.docs.map((d) => ({
            id: d.id,
            ...(d.data() as Omit<MembershipDoc, "id">),
          }));

          setMemberships(list);

          // Decide active org (persisted > first membership)
          const stored = localStorage.getItem(LS_KEY);
          const storedIsValid = stored && list.some((m) => m.orgId === stored);

          const nextActive = (storedIsValid ? stored : list[0]?.orgId) ?? null;

          setActiveOrgIdState(nextActive);

          setLoading(false);
        },
        () => setLoading(false)
      );

      return unsubMemberships;
    });

    return () => unsubAuth();
  }, []);

  // 2) Load org docs for display names (optional but improves dropdown UX)
  useEffect(() => {
    const orgIds = Array.from(new Set(memberships.map((m) => m.orgId)));
    if (orgIds.length === 0) {
      setOrgsById({});
      return;
    }

    // Firestore "in" supports up to 10 values. If you ever exceed 10,
    // we can chunk this — but most users won’t belong to >10 orgs.
    const q = query(
      collection(db, "organizations"),
      where(documentId(), "in", orgIds.slice(0, 10))
    );

    const unsub = onSnapshot(q, (snap) => {
      const map: Record<string, OrgDoc> = {};
      snap.docs.forEach((d) => {
        const data = d.data() as any;
        map[d.id] = {
          id: d.id,
          name: data.name,
          legalName: data.legalName,
          logoUrl: data.logoUrl,
          phone: data.phone,
          email: data.email,
          address: data.address ?? null,
        };
      });
      setOrgsById(map);
    });

    return () => unsub();
  }, [memberships]);

  const activeOrgName = useMemo(() => {
    if (!activeOrgId) return null;
    const org = orgsById[activeOrgId];
    return org?.name || org?.legalName || activeOrgId;
  }, [activeOrgId, orgsById]);

  return {
    memberships,
    orgId: activeOrgId,
    activeOrgName,
    setActiveOrgId,
    loading,
  };
}
