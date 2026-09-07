/**
 * Linking the crosshair across a multi-chart grid.
 *
 * Pro's 2-up and 4-up grids are the tier's identity, but today they are just
 * independent charts sitting side by side: hovering VCB tells you nothing about
 * what CTG was doing at that moment, which is the only reason to look at four
 * symbols at once. Linking the crosshair is what turns a grid into a
 * comparison.
 *
 * The link is by TIME, never by index. Two symbols do not have the same bars —
 * one may have been halted, listed later, or simply have a shorter history — so
 * bar 40 of VCB and bar 40 of CTG are routinely different days. Sharing an index
 * would silently line up unrelated sessions, which is worse than not linking at
 * all because it looks like it works.
 *
 * Pure, so the alignment rule is testable without a grid.
 */
import type { Bar } from "../types.ts";

/**
 * How far a companion bar may be from the hovered moment and still count.
 *
 * A fraction of the bar spacing rather than a fixed duration, because the same
 * rule has to hold for one-minute bars and monthly ones. Just over half a bar
 * means every moment inside a bar resolves to that bar, and a gap where a
 * companion has no data resolves to nothing.
 */
export const LINK_TOLERANCE = 0.75;

/** Median spacing between bars — robust to the weekend gaps a mean would smear. */
export function barSpacing(bars: Bar[]): number {
  if (bars.length < 2) return 0;
  const gaps: number[] = [];
  for (let i = 1; i < bars.length; i++) gaps.push(bars[i].t - bars[i - 1].t);
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)] || 0;
}

/**
 * Which bar of `bars` corresponds to the moment `t`, or `null`.
 *
 * Returns null rather than the nearest bar when nothing is close enough: a
 * companion that did not trade at that moment should show NO crosshair, not one
 * parked on whatever bar happens to be nearest. A crosshair on the wrong day is
 * a wrong number in the read-out beside it.
 */
export function linkedIndex(bars: Bar[], t: number | null, tolerance = LINK_TOLERANCE): number | null {
  if (t === null || !bars.length || !Number.isFinite(t)) return null;
  const spacing = barSpacing(bars);
  // A single-bar series has no spacing to scale by; only an exact-ish hit counts.
  const limit = spacing > 0 ? spacing * tolerance : 0;

  // Binary search: this runs for every companion cell on every pointer move.
  let lo = 0, hi = bars.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].t < t) lo = mid + 1; else hi = mid;
  }
  // `lo` is the first bar at or after `t`; its predecessor may be nearer.
  const cands = lo > 0 ? [lo - 1, lo] : [lo];
  let best = -1, bestGap = Infinity;
  for (const i of cands) {
    const gap = Math.abs(bars[i].t - t);
    if (gap < bestGap) { best = i; bestGap = gap; }
  }
  if (best === -1) return null;
  return bestGap <= limit ? best : null;
}
