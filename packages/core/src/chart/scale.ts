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
