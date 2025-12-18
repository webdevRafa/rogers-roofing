import { createContext, useContext } from "react";
import type { MembershipDoc } from "../hooks/useMembership";

type OrgContextValue = {
  orgId: string | null;
  orgName: string | null;
  memberships: MembershipDoc[];
  setOrgId: (orgId: string) => void;
  loading: boolean;
};

const OrgContext = createContext<OrgContextValue | null>(null);

export function OrgProvider({
  value,
  children,
}: {
  value: OrgContextValue;
  children: React.ReactNode;
}) {
  return <OrgContext.Provider value={value}>{children}</OrgContext.Provider>;
}

export function useOrg() {
  const ctx = useContext(OrgContext);
  if (!ctx) throw new Error("useOrg must be used inside OrgProvider");
  return ctx;
}
