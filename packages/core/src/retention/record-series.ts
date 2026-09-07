/**
 * Recording gold prices so a gold CHART can exist.
 *
 * The upstream publishes a live snapshot and no history whatsoever, so every
 * bar this chart will ever show has to be written by this job. Two consequences
 * worth stating plainly rather than discovering later: the history begins on the
 * day this first runs — which is why the chart labels itself with its own start
 * date instead of implying years of data — and a day this misses is a gap
 * nothing can backfill.
 *
 * Lives here rather than inside a route because it is called from two places:
 * its own endpoint, for manual runs and tests, and the existing daily cron. A
 * FIFTH entry in `vercel.json` would risk the Hobby cron quota, and a feature
 * that breaks the deploy is worse than one that shares a schedule.
 */
import type { Db, SeriesPoint } from "../db/types.ts";
import type { GoldSnapshot } from "../types.ts";
import { GOLD_SERIES, dayBucket, seriesKey } from "../chart/series.ts";

export interface RecordResult {
  t: number;
  written: number;
  /** Series the snapshot did not carry, so a shrinking feed is visible. */
  missing: string[];
}

/**
 * The point for one gold row.
 *
 * The MID of bid and ask, because a chart of the sell price alone would move
 * whenever the spread widened — a dealer's decision, not a change in the price
 * of gold. One snapshot a day cannot know the day's true high and low, so all
 * four are the same number; a chart implying an intraday range it never observed
 * would be worse than a flat one.
 */
export function pointFor(buy: number, sell: number, t: number): SeriesPoint | null {
  const mid = (buy + sell) / 2;
  if (!Number.isFinite(mid) || mid <= 0) return null;
  return { t, o: mid, h: mid, l: mid, c: mid, v: 0 };
}

export async function recordGoldSeries(
  db: Db,
  snapshot: GoldSnapshot,
  nowMs: number,
): Promise<RecordResult> {
  const t = dayBucket(nowMs);
  const byCode = new Map(snapshot.rows.map((r) => [r.code, r]));
  if (snapshot.world) byCode.set(snapshot.world.code, snapshot.world);

  let written = 0;
  const missing: string[] = [];
  for (const code of GOLD_SERIES) {
    const row = byCode.get(code);
    const point = row ? pointFor(row.buy, row.sell, t) : null;
    if (!point) { missing.push(code); continue; }
    await db.series.append(seriesKey(code), [point]);
    written++;
  }
  return { t, written, missing };
}
