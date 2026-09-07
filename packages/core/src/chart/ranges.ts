/**
 * Named time ranges — "show me the last three months", not "show me 63 bars".
 *
 * The chart offered exactly two: 120 bars, or everything. A reader thinks in
 * months and years, and on an intraday timeframe "120 bars" is a different span
 * every time, so the same button meant something different depending on the
 * interval it was pressed on.
 *
 * A preset resolves to a BAR COUNT rather than a date window because that is
 * what the pan/zoom machinery already speaks (`windowBounds`, `zoomAt`), so this
 * changes what the reader picks without touching how the chart draws.
 */
import type { Bar } from "../types.ts";

export type RangePreset = "1M" | "3M" | "6M" | "1Y" | "YTD" | "ALL";

export const RANGE_PRESETS: RangePreset[] = ["1M", "3M", "6M", "1Y", "YTD", "ALL"];

/** Calendar days each preset looks back. `YTD` and `ALL` are computed. */
const DAYS: Partial<Record<RangePreset, number>> = {
  "1M": 30, "3M": 90, "6M": 180, "1Y": 365,
};

/** Below this a chart is a handful of candles and a meaningless scale. */
export const MIN_PRESET_BARS = 20;

const DAY_MS = 86_400_000;
const ICT_OFFSET_MS = 7 * 3600 * 1000;

/** Start of the current year in Ho Chi Minh local time, as a unix second. */
function startOfYearIct(nowMs: number): number {
  const shifted = new Date(nowMs + ICT_OFFSET_MS);
  const jan1Utc = Date.UTC(shifted.getUTCFullYear(), 0, 1);
  return Math.floor((jan1Utc - ICT_OFFSET_MS) / 1000);
}

/**
 * How many of the most recent bars a preset covers.
 *
 * Counted from the bars actually loaded, not from the calendar: a feed that
 * only serves 400 daily bars cannot show five years, and returning a number
 * larger than the series would silently mean "all" while claiming otherwise.
 * Always at least `MIN_PRESET_BARS`, so picking "1 month" on a weekly chart
 * still leaves something legible.
 */
export function barsForPreset(bars: Bar[], preset: RangePreset, nowMs = Date.now()): number {
  if (bars.length === 0) return 0;
  if (preset === "ALL") return bars.length;

  const cutoff = preset === "YTD"
    ? startOfYearIct(nowMs)
    : Math.floor((nowMs - (DAYS[preset] ?? 30) * DAY_MS) / 1000);

  // The bars are ascending, so the first one at or after the cutoff starts the
  // window; everything from there to the end is what the preset covers.
  let first = bars.findIndex((b) => b.t >= cutoff);
  if (first === -1) first = bars.length - 1; // every bar predates the cutoff
  const count = bars.length - first;
  return Math.min(bars.length, Math.max(MIN_PRESET_BARS, count));
}

/**
 * Which preset a bar count corresponds to, or null when the reader has zoomed
 * to something in between. Used to light the matching button — a control that
 * shows nothing selected after a wheel-scroll looks broken, but claiming "3M"
 * for an arbitrary zoom would be a lie, so "no preset" is a real answer.
 */
export function presetForBars(bars: Bar[], count: number, nowMs = Date.now()): RangePreset | null {
  return RANGE_PRESETS.find((p) => barsForPreset(bars, p, nowMs) === count) ?? null;
}
