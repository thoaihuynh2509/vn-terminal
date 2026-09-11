/**
 * How price maps to pixels: linear, logarithmic, or percent change.
 *
 * The chart only ever had a linear axis, which is the wrong one for the two
 * questions a long window is usually asked. Over years, a linear axis makes a
 * move from 10 to 20 look smaller than one from 100 to 110, though the first
 * doubled a holding and the second added a tenth. And when comparing, what a
 * reader wants on the axis is not the price at all but how far it has come.
 *
 * Everything maps through one pair of functions, so reference lines, drawings,
 * alert levels and the crosshair follow the scale automatically instead of each
 * needing to know which one is active.
 *
 * Pure: no DOM, no formatting, no locale — those belong to the renderer.
 */
export type ScaleId = "lin" | "log" | "pct";

export const SCALES: ScaleId[] = ["lin", "log", "pct"];
export const DEFAULT_SCALE: ScaleId = "lin";

export function isScale(v: unknown): v is ScaleId {
  return typeof v === "string" && (SCALES as string[]).includes(v);
}

/**
 * A log axis needs strictly positive bounds, and a percent axis needs a
 * non-zero baseline. Neither holds for every series a pane might show, so this
 * decides ONCE whether the requested scale is usable and the caller falls back
 * to linear — silently drawing a broken axis would be worse than ignoring the
 * reader's choice.
 */
export function usable(id: ScaleId, min: number, max: number, base: number): boolean {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return false;
  if (id === "log") return min > 0 && max > 0;
  if (id === "pct") return Number.isFinite(base) && base > 0;
  return true;
}

/** The scale actually in force, after checking the data supports it. */
export function effectiveScale(id: ScaleId, min: number, max: number, base: number): ScaleId {
  return usable(id, min, max, base) ? id : "lin";
}

/** Percent change of `v` against `base`. */
export function pctOf(v: number, base: number): number {
  return ((v - base) / base) * 100;
}

/**
 * Position of `v` in the pane, 0 at `min` and 1 at `max`.
 *
 * `pct` is deliberately identical to `lin` here: percent change is a strictly
 * increasing linear function of price, so the geometry does not move — only the
 * axis LABELS change. Treating it as its own geometry would place bars at
 * slightly different pixels for no reason and break nothing visibly, which is
 * the worst kind of difference.
 */
export function norm(id: ScaleId, v: number, min: number, max: number): number {
  if (id === "log") {
    const lo = Math.log(min), hi = Math.log(max);
    return hi === lo ? 0.5 : (Math.log(v) - lo) / (hi - lo);
  }
  return max === min ? 0.5 : (v - min) / (max - min);
}

/** Inverse of `norm` — turns a cursor position back into a price. */
export function denorm(id: ScaleId, f: number, min: number, max: number): number {
  if (id === "log") {
    const lo = Math.log(min), hi = Math.log(max);
    return Math.exp(lo + f * (hi - lo));
  }
  return min + f * (max - min);
}

/**
 * Axis values to label.
 *
 * Linear and percent step evenly through price. Log steps evenly through the
 * EXPONENT, so the gaps a reader sees on screen are equal, which is the entire
 * reason to pick a log axis — evenly spaced prices on a log axis would bunch
 * every label at the top.
 */
export function scaleTicks(id: ScaleId, min: number, max: number, count = 4): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) return [min];
  const n = Math.max(1, Math.floor(count));
  if (id === "log" && min > 0 && max > 0) {
    const lo = Math.log(min), hi = Math.log(max);
    return Array.from({ length: n + 1 }, (_, i) => Math.exp(lo + ((hi - lo) * i) / n));
  }
  return Array.from({ length: n + 1 }, (_, i) => min + ((max - min) * i) / n);
}

/**
 * Padding applied to the data range before it becomes the axis range.
 *
 * On a log axis the padding has to be MULTIPLICATIVE. Adding a fixed amount to
 * a log range pads the bottom far more than the top in percentage terms, which
 * tilts the whole series and is exactly the distortion a log axis exists to
 * remove.
 */
export function padRange(id: ScaleId, min: number, max: number, frac = 0.06): { min: number; max: number } {
  if (id === "log" && min > 0 && max > 0) {
    const f = 1 + frac;
    return { min: min / f, max: max * f };
  }
  const pad = (max - min) * frac || Math.abs(max) * 0.02 || 1;
  return { min: min - pad, max: max + pad };
}

/** Lowest and highest value found, and how many non-null values were seen. */
export interface Extent { lo: number; hi: number; n: number }

/**
 * The extent of one or more series, with `Math.min`/`Math.max` semantics but
 * none of their calling convention.
 *
 * `Math.min(...values)` passes every value as a function ARGUMENT. A price
 * pane at "Tất cả" with a dozen overlays spread about 42,000 of them, twice per
 * render — slow, and close enough to the engine's argument ceiling that a
 * longer series would throw instead of drawing. A loop has no ceiling.
 *
 * The semantics are the ones the spreads had, deliberately, so this is a
 * refactor and not a behaviour change: `null` is a hole and is skipped, while
 * `NaN` poisons the result exactly as it poisons `Math.min`. An empty input is
 * `{ lo: Infinity, hi: -Infinity, n: 0 }`, which is what `Math.min()` and
 * `Math.max()` return.
 */
export function seriesExtent(series: readonly (readonly (number | null)[])[]): Extent {
  let lo = Infinity, hi = -Infinity, n = 0, poisoned = false;
  for (const s of series) {
    for (const v of s) {
      if (v === null) continue;
      n++;
      if (v !== v) { poisoned = true; continue; }
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  return poisoned ? { lo: NaN, hi: NaN, n } : { lo, hi, n };
}

/**
 * The price pane's domain: the bars' lows and highs, every overlay's values,
 * and any extra levels (reference lines) that must stay on screen.
 *
 * Lows feed only the bottom and highs only the top, so a `NaN` low poisons the
 * low alone — the same asymmetry `Math.min(...lows)` / `Math.max(...highs)` had.
 */
export function priceExtent(
  bars: readonly { l: number; h: number }[],
  series: readonly (readonly (number | null)[])[],
  extra: readonly number[],
): Extent {
  let lo = Infinity, hi = -Infinity, loNaN = false, hiNaN = false;
  for (const b of bars) {
    if (b.l !== b.l) loNaN = true; else if (b.l < lo) lo = b.l;
    if (b.h !== b.h) hiNaN = true; else if (b.h > hi) hi = b.h;
  }
  const s = seriesExtent([...series, extra]);
  if (s.lo !== s.lo) { loNaN = true; hiNaN = true; }
  else if (s.n) { if (s.lo < lo) lo = s.lo; if (s.hi > hi) hi = s.hi; }
  return { lo: loNaN ? NaN : lo, hi: hiNaN ? NaN : hi, n: bars.length + s.n };
}
