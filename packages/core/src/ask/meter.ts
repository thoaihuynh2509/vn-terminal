/**
 * The free-ask meter.
 *
 * The assistant is the only endpoint whose cost scales with use, so a
 * non-entitled reader gets a taste and then the paywall. That taste is the
 * closest thing the site has to a trial, and until now nobody was told they
 * were on one — they spent both asks and met a wall that arrived without
 * warning, which reads as a product that changed its mind rather than one with
 * a published limit.
 *
 * Pure and dependency-free so the count a reader is SHOWN and the count the
 * route ENFORCES are the same arithmetic. Two implementations of one limit is
 * how a paywall starts lying.
 */
import { can, type Tier } from "../auth/entitlement.ts";

/** Free assistant tries a non-entitled reader gets before the paywall. */
export const FREE_ASK_LIMIT = 2;

/**
 * Asks this reader may still spend — the ENFORCEMENT answer, so `0` denies.
 *
 * `null` is a subscriber, who has no ceiling; `0` is a reader who may not ask,
 * whether they spent the taste or never had one. `metered` is false when there
 * is no signing secret to keep the count in, and an un-keepable count would be
 * re-granted on every reload.
 */
export function freeAsksLeft(tier: Tier, asks: number | undefined, metered: boolean): number | null {
  if (can(tier, "use:ai-assistant")) return null;
  if (!metered) return 0;
  // The count arrives from a cookie. It is signed, so it should not be corrupt —
  // but a meter that can go negative can be argued into granting free asks.
  const used = typeof asks === "number" && Number.isFinite(asks) && asks > 0 ? Math.floor(asks) : 0;
  return Math.max(0, FREE_ASK_LIMIT - used);
}

/**
 * Asks to DISPLAY, which is a different question. `null` means "show no meter".
 *
 * The two answers diverge on exactly one input, and it matters: with no signing
 * secret, enforcement says 0 (refuse) but the surface must not say 0 (a locked
 * box). Treating those as the same number deletes the home page's assistant on
 * any deployment missing `AUTH_SECRET` — the empty default that `.env.example`
 * ships — turning a config slip into a silently missing feature. The honest
 * fallback is the pre-meter behaviour: show the box, let the server refuse.
 */
export function freeAsksToShow(tier: Tier, asks: number | undefined, metered: boolean): number | null {
  return metered ? freeAsksLeft(tier, asks, metered) : null;
}
