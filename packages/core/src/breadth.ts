/**
 * Market breadth: how much of the market is participating in a move.
 *
 * An index is capitalisation-weighted, so VNINDEX can rise on two large banks
 * while most of the board falls. Breadth is the question that answers — "is this
 * a real advance or three stocks carrying it" — and it is the thing an index
 * chart structurally cannot show you.
 *
 * The measure here is the percentage of members trading above their own 20-day
 * average. It is the standard one, it is bounded 0–100 so a level means the same
 * thing in any market, and 50 is a genuine midpoint rather than a chosen
 * threshold.
 *
 * Pure: the fetching and caching live in the provider.
 */
import type { Bar } from "./types.ts";

export interface BreadthPoint {
  t: number;
  /** Percent of members above their own SMA(period). */
  pctAbove: number;
  advancers: number;
  decliners: number;
  /** Members with enough history to count at this date. */
  counted: number;
}

export interface Member {
  symbol: string;
  bars: Bar[];
}

/**
 * Breadth per date.
 *
 * A member is counted on a date only when it has `period` bars of history by
 * then — including one earlier would make the average a different measure on
 * different days. Dates where fewer than `minMembers` qualify are dropped
 * entirely rather than reported as a percentage of two stocks, which would swing
 * between 0 and 100 and look like signal.
 */
export function computeBreadth(members: Member[], period = 20, minMembers = 5): BreadthPoint[] {
  if (members.length === 0) return [];

  // Per symbol: close and the trailing average at each timestamp.
  const byT = new Map<number, { above: number; up: number; down: number; counted: number }>();

  for (const m of members) {
    const bars = m.bars;
    if (bars.length < period) continue;
    let windowSum = 0;
    for (let i = 0; i < bars.length; i++) {
      windowSum += bars[i].c;
      if (i >= period) windowSum -= bars[i - period].c;
      if (i < period - 1) continue;

      const sma = windowSum / period;
      const slot = byT.get(bars[i].t) ?? { above: 0, up: 0, down: 0, counted: 0 };
      slot.counted += 1;
      if (bars[i].c > sma) slot.above += 1;
      const prev = i > 0 ? bars[i - 1].c : bars[i].c;
      if (bars[i].c > prev) slot.up += 1;
      else if (bars[i].c < prev) slot.down += 1;
      byT.set(bars[i].t, slot);
    }
  }

  return [...byT.entries()]
    .filter(([, v]) => v.counted >= minMembers)
    .sort((a, b) => a[0] - b[0])
    .map(([t, v]) => ({
      t,
      pctAbove: (v.above / v.counted) * 100,
      advancers: v.up,
      decliners: v.down,
      counted: v.counted,
    }));
}

/**
 * Align a breadth series to a chart's bars, so it can be drawn against the same
 * x-scale. Dates the chart does not show become null rather than being
 * interpolated — a breadth reading invented for a date it was not measured on
 * is a made-up number.
 */
export function alignBreadth(points: BreadthPoint[], bars: Bar[]): (number | null)[] {
  const byT = new Map(points.map((p) => [p.t, p.pctAbove]));
  return bars.map((b) => byT.get(b.t) ?? null);
}
