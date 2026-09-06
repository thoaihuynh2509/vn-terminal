/**
 * Tiers and what each unlocks.
 *
 * Pure and dependency-free so it can be unit tested and imported from both
 * server and client code. Entitlement is DATA; enforcement lives on the server.
 *
 * Capabilities are named after chart-terminal features — the paid surface is the
 * analysis workspace, not content.
 */
export type Tier = "anon" | "free" | "plus" | "pro";

export const TIER_ORDER: Tier[] = ["anon", "free", "plus", "pro"];

export type Capability =
  | "chart:basic"          // candles, volume, daily and higher timeframes
  | "chart:intraday"       // minute and hour timeframes
  | "chart:indicators"     // the full indicator library
  | "chart:multi"          // multi-pane / multi-chart layouts
  | "chart:drawings"       // the drawing tools themselves
  | "chart:compare"        // overlay a second symbol
  | "alerts:create"        // price alerts, evaluated in the open tab
  | "alerts:email"         // those alerts also delivered while you are away
  | "sync:docs"            // saved artifacts follow the account across devices
  | "save:watchlist"
  | "use:ai-assistant";

/**
 * What each tier may do.
 *
 * Drawings and alerts are deliberately open to `free`. A reader who has drawn a
 * level or armed an alert has a reason to come back, and a reader who never
 * comes back never buys anything — gating the first one of each optimised for a
 * conversion that the habit had not yet earned. The paid line is drawn instead
 * at DEPTH (how many, see the limits below), REACH (`alerts:email` — what we do
 * for you while the tab is closed) and PORTABILITY (`sync:docs` — whether the
 * work follows you to another device).
 */
const GRANTS: Record<Tier, Capability[]> = {
  anon: ["chart:basic"],
  free: ["chart:basic", "save:watchlist", "chart:drawings", "alerts:create"],
  plus: [
    "chart:basic", "chart:intraday", "chart:indicators", "chart:compare", "chart:drawings",
    "save:watchlist", "alerts:create", "alerts:email", "sync:docs", "use:ai-assistant",
  ],
  pro: [
    "chart:basic", "chart:intraday", "chart:indicators", "chart:multi", "chart:drawings",
    "chart:compare", "alerts:create", "alerts:email", "sync:docs", "save:watchlist",
    "use:ai-assistant",
  ],
};

export function can(tier: Tier, capability: Capability): boolean {
  return GRANTS[tier].includes(capability);
}

export function atLeast(tier: Tier, min: Tier): boolean {
  return TIER_ORDER.indexOf(tier) >= TIER_ORDER.indexOf(min);
}

/** Indicator slots a tier may have active at once. Free gets a taste. */
export const INDICATOR_LIMIT: Record<Tier, number> = { anon: 1, free: 2, plus: 8, pro: 25 };

/**
 * Saved setups per tier — layouts and indicator templates share this pool, so
 * the pricing page can state one number instead of two. Free gets exactly one:
 * enough to have something saved worth coming back to, and the second one is
 * the first honest reason to upgrade.
 */
export const LAYOUT_LIMIT: Record<Tier, number> = { anon: 0, free: 1, plus: 5, pro: 25 };

/**
 * Drawings per SYMBOL (not per account) — a reader marks up the few tickers
 * they actually hold, so a per-account cap would punish following more names.
 * `pro` is a ceiling no human reaches rather than a true infinity: unbounded
 * rows are a denial-of-service on our own database.
 */
export const DRAWING_LIMIT: Record<Tier, number> = { anon: 0, free: 3, plus: 25, pro: 200 };

/**
 * Active price alerts per tier. Free gets three that fire in the open tab;
 * `alerts:email` is what makes them reach you when it is closed.
 */
export const ALERT_LIMIT: Record<Tier, number> = { anon: 0, free: 3, plus: 20, pro: 100 };

export function capabilitiesFor(tier: Tier): Capability[] {
  return [...GRANTS[tier]];
}
