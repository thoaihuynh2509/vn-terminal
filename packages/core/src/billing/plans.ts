/**
 * Prices and durations — the ONLY place to change what a tier costs.
 *
 * Pure and dependency-free so it imports into client, server and tests alike.
 * Amounts are whole VND (MoMo takes an integer, never a decimal). A billing
 * period is a fixed number of days of access, not a recurring card charge:
 * MoMo one-time payments do not auto-renew, so a subscription is time-boxed and
 * the reader renews. `exp` on the session is what enforces it.
 */
import type { Tier } from "../auth/entitlement.ts";

export type PaidTier = Extract<Tier, "plus" | "pro">;
export type Plan = "monthly" | "annual";

export interface PriceOption {
  amount: number; // whole VND
  days: number; // days of access granted
}

/** Change prices here. `days` is how long a purchase unlocks the tier. */
export const PRICES: Record<PaidTier, Record<Plan, PriceOption>> = {
  plus: {
    monthly: { amount: 99_000, days: 30 },
    annual: { amount: 990_000, days: 365 },
  },
  pro: {
    monthly: { amount: 199_000, days: 30 },
    annual: { amount: 1_990_000, days: 365 },
  },
};

export function isPaidTier(v: unknown): v is PaidTier {
  return v === "plus" || v === "pro";
}

export function isPlan(v: unknown): v is Plan {
  return v === "monthly" || v === "annual";
}

export function priceFor(tier: PaidTier, plan: Plan): PriceOption {
  return PRICES[tier][plan];
}

/** Whole-percent saving of the annual plan vs. twelve monthly charges. */
export function annualSavingPct(tier: PaidTier): number {
  const { monthly, annual } = PRICES[tier];
  const full = monthly.amount * 12;
  if (full <= 0) return 0;
  return Math.round(((full - annual.amount) / full) * 100);
}

/** Subscription end for a purchase made at `now`. */
export function expiryFrom(now: Date, plan: Plan, tier: PaidTier): Date {
  return new Date(now.getTime() + priceFor(tier, plan).days * 24 * 60 * 60 * 1000);
}
