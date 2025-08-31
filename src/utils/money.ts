// src/utils/money.ts
export const toCents = (amount: number) => Math.round((Number(amount) || 0) * 100);
export const fromCents = (cents: number | null | undefined) => ((cents ?? 0) / 100);
export const formatCurrency = (cents: number | null | undefined, currency: "USD" | "CAD" = "USD") =>
  fromCents(cents).toLocaleString(undefined, { style: "currency", currency });
