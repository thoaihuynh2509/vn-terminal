/**
 * Loading older bars when the reader pans past the left edge.
 *
 * The chart fetches one window and that is all it will ever show, so panning
 * back stops at a wall well short of what the feed actually holds. This is the
 * merge layer for extending it.
 *
 * What the feed actually serves, probed 2026-09-07 against DNSE
 * (`scripts/probe-events.mjs` is the sibling probe for events; this one was run
 * ad hoc and its numbers are recorded here because they are the ONLY reason the
 * caps below are what they are):
 *
 *   - Daily and above: back to 2012-03-20. FPT, HPG and VCB all start on that
 *     exact date, so it is the feed's own floor rather than a listing date.
 *     Symbols listed later start later — ACV begins 2016-11-21.
 *   - Intraday, every resolution: about 90 days. A 120-to-90-day window returns
 *     bars; a 200-to-150-day window returns none. The limit is the feed's
 *     retention, not the resolution, so 1m and 15m hit the same wall.
 *
 * Pure: the merge and the stop condition are testable without a network.
 */
import type { Bar } from "../types.ts";

/** Oldest bar the daily feed serves, whatever the symbol. */
export const DAILY_FLOOR_ISO = "2012-03-20";
/** Roughly how far back intraday goes, in days. */
export const INTRADAY_FLOOR_DAYS = 90;

/**
 * Combine a newly fetched older page with what is already loaded.
 *
 * Deduped by timestamp with the EXISTING bar winning. The overlap between two
 * requests is the same sessions fetched twice, and the copy already on screen is
 * the one drawings, alerts and the crosshair are currently pinned to — replacing
 * it would be a no-op at best and a flicker at worst.
 */
export function mergeBars(existing: Bar[], older: Bar[]): Bar[] {
  if (!older.length) return existing;
  if (!existing.length) return [...older].sort((a, b) => a.t - b.t);

  const seen = new Set(existing.map((b) => b.t));
  const add = older.filter((b) => Number.isFinite(b.t) && !seen.has(b.t));
  if (!add.length) return existing;
  return [...add, ...existing].sort((a, b) => a.t - b.t);
}

/**
 * Whether a fetch actually extended the history.
 *
 * A page that merges to the same length means the feed has nothing older, and
 * the caller must stop asking. Without this the chart re-requests the same empty
 * window on every pan frame at the left edge.
 */
export function grew(before: Bar[], after: Bar[]): boolean {
  return after.length > before.length;
}

/**
 * The window to request next, as unix seconds.
 *
 * Asks for `count` bars' worth of time before the oldest bar held, with a
 * generous multiplier: a trading calendar has weekends and holidays in it, so
 * asking for exactly `count` days of clock time reliably returns fewer than
 * `count` bars and the chart would creep backwards a few sessions at a time.
 */
export function olderWindow(
  oldestT: number,
  bucketSec: number,
  count: number,
): { from: number; to: number } {
  const span = Math.max(1, bucketSec) * Math.max(1, count);
  // 1.6x mirrors the over-fetch the primary bars request already uses.
  return { from: Math.floor(oldestT - span * 1.6), to: Math.floor(oldestT) - 1 };
}

/**
 * Whether the visible window has reached the left edge of what is loaded.
 *
 * A margin rather than an exact hit, so the fetch starts slightly before the
 * reader arrives and the bars are usually there by the time they get to them.
 */
export function atLeftEdge(total: number, range: number, offset: number, margin = 10): boolean {
  if (range <= 0 || range >= total) return true;
  return total - range - offset <= margin;
}
