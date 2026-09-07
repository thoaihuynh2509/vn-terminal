/**
 * "Your line at 65.00 is 0.4% away."
 *
 * A drawn level is the clearest signal a reader has told us what they care
 * about — more specific than a watchlist entry and more deliberate than a page
 * view. Surfacing the ones price has walked up to is the most personal thing the
 * daily brief can say, and it costs nothing to compute: the drawings are already
 * stored.
 *
 * Pure, so the wording and the threshold are testable without a database.
 */
import { trendPriceAt, type Drawing } from "../chart/drawings.ts";

export interface NearLevel {
  symbol: string;
  /** The level's price at the moment it was checked. */
  price: number;
  /** Signed distance from the current price, in percent. */
  distancePct: number;
  kind: "hline" | "trend";
}

/** Within this much of a level counts as "price is at it". */
export const NEAR_PCT = 1;

/**
 * Levels within `tolerancePct` of `price`.
 *
 * Only horizontal lines and trend lines are considered, and the reason is
 * honesty rather than laziness: those two ARE a price the reader chose. A
 * Fibonacci retracement or a channel is a construction with several implied
 * levels, and picking one to report would be us deciding what they meant.
 *
 * A trend line is evaluated at `now`, because that is the whole point of one —
 * its level today is not the level it was drawn at.
 */
export function levelsNearPrice(
  symbol: string,
  drawings: Drawing[],
  price: number,
  nowSec: number,
  tolerancePct = NEAR_PCT,
): NearLevel[] {
  if (!Number.isFinite(price) || price <= 0) return [];
  const out: NearLevel[] = [];

  for (const d of drawings) {
    // The kind is captured in the branch that proves it, so the reported kind
    // cannot drift from the level it was computed from.
    let level: number | null = null;
    let kind: NearLevel["kind"] | null = null;
    if (d.kind === "hline") { level = d.price; kind = "hline"; }
    // A trade marker is an entry, not a level the reader is watching for.
    else if (d.kind === "trade") continue;
    else if (d.kind === "trend") { level = trendPriceAt(d, nowSec); kind = "trend"; }
    if (level === null || kind === null || !Number.isFinite(level) || level <= 0) continue;

    const distancePct = ((level - price) / price) * 100;
    if (Math.abs(distancePct) > tolerancePct) continue;
    out.push({ symbol: symbol.toUpperCase(), price: level, distancePct, kind });
  }

  // Nearest first: if the brief has to cut the list, it keeps the ones the
  // reader is most likely to act on.
  return out.sort((a, b) => Math.abs(a.distancePct) - Math.abs(b.distancePct));
}
