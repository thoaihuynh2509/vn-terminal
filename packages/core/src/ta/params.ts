/**
 * Tunable indicator periods.
 *
 * Every indicator shipped with its period welded on — RSI was 14 and could only
 * ever be 14 — which is the difference between a chart you look at and one you
 * work in. A trader who runs a 21-day RSI could not run this chart at all.
 *
 * The active set stays an array of STRINGS so nothing downstream has to change
 * shape: `"rsi"` is the indicator at its default, `"rsi:21"` the same indicator
 * tuned. Links, saved layouts and stored setups written before this all parse
 * as the default, so no reader loses a chart and there is no migration.
 *
 * Tuning is free. SAVING a tuned set is what a layout slot buys — a paywall in
 * front of the knob would teach readers the chart is not theirs to work in.
 */
import type { IndicatorDef } from "./registry.ts";

export interface IndicatorRef {
  id: string;
  /** `null` means "whatever the registry calls default". */
  period: number | null;
}

/**
 * Ids are lowercase alphanumerics; the period is a positive integer.
 *
 * The digit ceiling is deliberately well past any real period (the largest the
 * registry allows is 400) because an oversized number is CLAMPED, not refused —
 * a hand-typed `rsi:99999` should give the longest RSI the chart supports
 * rather than silently dropping the indicator. Past six digits it is not a
 * mistyped period any more, and the parse stays bounded.
 */
const TOKEN_RE = /^([a-z][a-z0-9]{0,23})(?::([0-9]{1,6}))?$/;

/**
 * Read one `id` or `id:period` token.
 *
 * Returns `null` for anything malformed rather than a partly-parsed ref: a
 * mangled token in a shared link should drop that one indicator, not silently
 * apply a period nobody chose.
 */
export function parseRef(token: string): IndicatorRef | null {
  const m = TOKEN_RE.exec(token.trim().toLowerCase());
  if (!m) return null;
  const period = m[2] === undefined ? null : Number(m[2]);
  if (period !== null && (!Number.isInteger(period) || period < 1)) return null;
  return { id: m[1], period };
}

/**
 * Write a ref back to a token. A period equal to the default is OMITTED, so an
 * untouched chart keeps a clean URL and two readers who never opened the
 * settings share byte-identical links.
 */
export function formatRef(ref: IndicatorRef, def?: IndicatorDef): string {
  if (ref.period === null) return ref.id;
  if (def && (!def.param || ref.period === def.param.default)) return ref.id;
  return `${ref.id}:${ref.period}`;
}

/**
 * The period an indicator will actually be computed with.
 *
 * Out-of-range values are CLAMPED rather than rejected: a period of 100000 in a
 * hand-typed URL should give the reader the longest average the chart supports,
 * not a broken pane. An indicator with no tunable period always reports 0 —
 * callers pass it through and its `compute` ignores it.
 */
export function effectivePeriod(def: IndicatorDef, period: number | null): number {
  if (!def.param) return 0;
  if (period === null || !Number.isFinite(period)) return def.param.default;
  return clampPeriod(def, period);
}

export function clampPeriod(def: IndicatorDef, n: number): number {
  if (!def.param) return 0;
  const { min, max } = def.param;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** Menu and legend text: "RSI (21)". Untunable indicators keep their own name. */
export function labelFor(def: IndicatorDef, period: number | null): string {
  return def.param ? `${def.label} (${effectivePeriod(def, period)})` : def.label;
}

/** Compact legend chip: "RSI21". */
export function shortFor(def: IndicatorDef, period: number | null): string {
  return def.param ? `${def.short}${effectivePeriod(def, period)}` : def.short;
}

/**
 * Whether two tokens name the same indicator, whatever they are tuned to.
 *
 * The toolbar toggles by INDICATOR, not by tuning: clicking RSI when a 21-day
 * RSI is on must turn that one off rather than add a second RSI beside it.
 */
export function sameIndicator(a: string, b: string): boolean {
  const ra = parseRef(a), rb = parseRef(b);
  return !!ra && !!rb && ra.id === rb.id;
}
