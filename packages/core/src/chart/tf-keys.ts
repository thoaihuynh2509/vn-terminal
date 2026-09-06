import { TIMEFRAMES, type Timeframe } from "./timeframes.ts";

/**
 * Keyboard control for the interval selector.
 *
 * Kept pure and separate from the component because the two ways this feature
 * breaks are both logic, not rendering: firing while the reader is typing in a
 * field, and resolving an ambiguous key to the wrong interval.
 */

/**
 * Whether a keystroke belongs to the element that has focus rather than to the
 * chart. The alert form lives on this page, so a shortcut that ignores this
 * would change the timeframe every time someone types a price.
 */
export function isEditable(el: { tagName?: string; isContentEditable?: boolean } | null): boolean {
  if (!el) return false;
  const tag = (el.tagName ?? "").toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable === true;
}

/**
 * Move one interval along the list. Does not wrap: stepping past 1 year back
 * round to 1 minute would be disorienting, and the ends are where a reader
 * expects to feel a stop. Locked intervals are skipped rather than landed on.
 */
export function stepTimeframe(currentId: string, delta: 1 | -1, allowIntraday: boolean): string | null {
  const list = TIMEFRAMES.filter((t) => allowIntraday || !t.intraday);
  const i = list.findIndex((t) => t.id === currentId);
  if (i === -1) return null;
  const next = list[i + delta];
  return next ? next.id : null;
}

/**
 * `m` is minutes and `M` is months — the convention every terminal uses, and an
 * ambiguity a reader typing quickly will hit. Case decides which to try first;
 * if that group has no such interval we fall through to the other, so "6m"
 * still finds 6 months and "12m" finds 1 year rather than doing nothing.
 */
const UNITS: Record<string, Timeframe["unit"][]> = {
  m: ["minute", "month"],
  M: ["month", "minute"],
  h: ["hour"], H: ["hour"],
  d: ["day"], D: ["day"],
  w: ["week"], W: ["week"],
  y: ["year"], Y: ["year"],
  mo: ["month"], MO: ["month"], Mo: ["month"],
};

/** Resolve a typed buffer such as "15m", "1D" or "3M" to an interval id. */
export function resolveTyped(buffer: string): string | null {
  const m = buffer.trim().match(/^(\d{1,3})([a-zA-Z]{1,2})$/);
  if (!m) return null;
  const n = Number(m[1]);
  const units = UNITS[m[2]];
  if (!units) return null;

  for (const unit of units) {
    const hit = TIMEFRAMES.find((t) => t.n === n && t.unit === unit);
    if (hit) return hit.id;
  }
  // A reader types the interval, not our unit labels: "60m" is an hour and
  // "12M" is a year, even though the table stores those as 1h and 1 year.
  if (units.includes("minute") && n % 60 === 0) {
    const hit = TIMEFRAMES.find((t) => t.n === n / 60 && t.unit === "hour");
    if (hit) return hit.id;
  }
  if (units.includes("month") && n % 12 === 0) {
    const hit = TIMEFRAMES.find((t) => t.n === n / 12 && t.unit === "year");
    if (hit) return hit.id;
  }
  return null;
}

/** Whether a key can start or continue a typed interval. */
export function isBufferKey(key: string): boolean {
  return /^[0-9a-zA-Z]$/.test(key);
}
