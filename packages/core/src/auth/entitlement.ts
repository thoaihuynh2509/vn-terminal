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
  | "chart:drawings"       // persisted drawing tools
  | "chart:compare"        // overlay a second symbol
  | "alerts:create"        // price alerts
  | "save:watchlist"
  | "use:ai-assistant";

const GRANTS: Record<Tier, Capability[]> = {
  anon: ["chart:basic"],
  free: ["chart:basic", "save:watchlist"],
  plus: [
    "chart:basic", "chart:intraday", "chart:indicators", "chart:compare",
    "save:watchlist", "alerts:create", "use:ai-assistant",
  ],
  pro: [
    "chart:basic", "chart:intraday", "chart:indicators", "chart:multi", "chart:drawings",
    "chart:compare", "alerts:create", "save:watchlist", "use:ai-assistant",
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

/** Saved chart layouts per tier. */
export const LAYOUT_LIMIT: Record<Tier, number> = { anon: 0, free: 1, plus: 5, pro: 25 };

/** Active price alerts per tier. */
export const ALERT_LIMIT: Record<Tier, number> = { anon: 0, free: 0, plus: 20, pro: 100 };

export function capabilitiesFor(tier: Tier): Capability[] {
  return [...GRANTS[tier]];
}
