import type { Session } from "./token.ts";
import { resolveTier, subscriptionExp } from "./provider.ts";
import type { UserRecord } from "../db/types.ts";

/**
 * Mint a session from an account row, carrying the meters forward.
 *
 * Every site that issues a cookie (sign-in, magic verify, refresh) goes through
 * here so a new one cannot silently drop `asks` and hand a spent free-AI meter
 * back at zero. Tier and `exp` come from the ROW and nothing else — the carry is
 * reader-supplied state, so a tampered cookie can never mint itself a tier.
 */
export interface SessionCarry {
  /** Member articles already counted against the free meter. */
  read?: string[];
  /** Free AI asks already spent. */
  asks?: number;
}

/**
 * The free-AI meter to carry into a new session, if it belongs to this reader.
 *
 * `getSession()` returns whatever cookie the browser presents, so signing in as
 * B on a machine where A spent their free asks would otherwise charge B for A's
 * spend. An anonymous meter (no email) is still carried — that is the point of
 * it, so signing in does not refill the teaser.
 */
export function carriedAsks(prior: Session | null | undefined, email: string): number | undefined {
  const owner = prior?.email;
  if (owner && owner.toLowerCase() !== email.toLowerCase()) return undefined;
  return prior?.asks;
}

export function remintSession(user: UserRecord, carry: SessionCarry, nowSec: number): Session {
  const exp = subscriptionExp(user);
  // Absent rather than undefined: decodeSession omits both keys when unset, and
  // a minted `asks: undefined` would serialise differently.
  return {
    email: user.email,
    tier: resolveTier(user),
    read: carry.read ?? [],
    iat: nowSec,
    ...(exp !== undefined ? { exp } : {}),
    ...(carry.asks !== undefined ? { asks: carry.asks } : {}),
  };
}
