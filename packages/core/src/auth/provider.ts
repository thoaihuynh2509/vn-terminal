import type { Tier } from "./entitlement.ts";
import type { UserRecord } from "../db/types.ts";

/**
 * Identity providers.
 *
 * `magic` is the real one: an emailed single-use link, no password anywhere.
 * `dev` is a passwordless local sign-in — give an email, get a session. It
 * exists so the paywall can be exercised end to end with no external service,
 * and it REFUSES to run in production: an unauthenticated "become anyone"
 * endpoint on a live site is a total auth bypass.
 *
 * Deliberately no password storage anywhere in this codebase. Credentials you
 * never hold cannot leak.
 */
export type AuthProvider = "dev" | "magic" | "disabled";

/**
 * Env only — this module is imported by client components, so it must never
 * reach for the database. Routes resolve `dbAvailable()` themselves and answer
 * 501 when a provider is configured but its storage is not.
 */
export function activeAuthProvider(): AuthProvider {
  const configured = process.env.AUTH_PROVIDER;
  if (configured === "magic") return "magic";
  if (configured === "disabled") return "disabled";
  if (configured === "dev") return process.env.NODE_ENV === "production" ? "disabled" : "dev";
  // Default: dev outside production, nothing in production.
  return process.env.NODE_ENV === "production" ? "disabled" : "dev";
}

export function isDevAuth(): boolean {
  return activeAuthProvider() === "dev";
}

/** Basic shape check — not validation of deliverability. */
export function looksLikeEmail(v: unknown): v is string {
  return typeof v === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) && v.length <= 254;
}

/**
 * The tier a signed-in reader gets.
 *
 * It is a property of the account row and of nothing else. The signature takes
 * the record rather than a requested value so a caller cannot talk itself into
 * a tier the account has not been granted.
 */
export function resolveTier(user: UserRecord): Tier {
  return user.tier;
}

/** The session `exp` (unix seconds) for a record, or undefined when it has no end. */
export function subscriptionExp(user: UserRecord): number | undefined {
  return user.tierExpiresAt ? Math.floor(user.tierExpiresAt.getTime() / 1000) : undefined;
}

/**
 * The tier a record actually grants right now: a paid tier past its expiry is
 * `free`. Server jobs (cron) read entitlement from the row, so they must apply
 * the same downgrade the session cookie applies at read time.
 */
export function effectiveTier(user: UserRecord, now: Date = new Date()): Tier {
  if (user.tierExpiresAt && user.tierExpiresAt.getTime() <= now.getTime()) return "free";
  return user.tier;
}
