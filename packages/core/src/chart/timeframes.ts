/**
 * Chart intervals.
 *
 * Every entry here is backed by data we can actually serve. The feed returns
 * native bars at 1/3/5/15/30 minutes, 1 day and 1 week; everything else in this
 * table is aggregated from one of those by `resample`. Intervals the feed cannot
 * support are deliberately absent rather than present-and-broken:
 *
 *   - seconds  — needs a tick feed; we have none
 *   - range bars — same, they are built from ticks, not from time
 *   - "1 hour" as a native request returns zero bars, so it is built from 30m
 *
 * `id` follows the convention every trading platform uses, where a lowercase m
 * is a minute and an uppercase M is a month. It is case-sensitive in the URL.
 */

/** Resolutions the upstream feed answers directly. */
export type FeedResolution = "1" | "3" | "5" | "15" | "30" | "1D" | "1W";

export type TfGroup = "minutes" | "hours" | "days";

export interface Timeframe {
  id: string;
  group: TfGroup;
  /** Count + unit, rendered through the dictionary so the label is localised. */
  n: number;
  unit: "minute" | "hour" | "day" | "week" | "month" | "year";
  /** What we ask the feed for. */
  fetch: FeedResolution;
  /** Aggregate the fetched bars into buckets of this many seconds. */
  bucket?: number;
  /** Aggregate into calendar months instead (3 = quarters, 12 = years). */
  months?: number;
  /** Calendar days of history to request. */
  lookback: number;
  intraday: boolean;
}

const MIN = 60;
const HOUR = 3600;

export const TIMEFRAMES: Timeframe[] = [
  { id: "1m",  group: "minutes", n: 1,  unit: "minute", fetch: "1",  lookback: 7,    intraday: true },
  { id: "3m",  group: "minutes", n: 3,  unit: "minute", fetch: "3",  lookback: 14,   intraday: true },
  { id: "5m",  group: "minutes", n: 5,  unit: "minute", fetch: "5",  lookback: 25,   intraday: true },
  { id: "15m", group: "minutes", n: 15, unit: "minute", fetch: "15", lookback: 60,   intraday: true },
  { id: "30m", group: "minutes", n: 30, unit: "minute", fetch: "30", lookback: 120,  intraday: true },
  { id: "45m", group: "minutes", n: 45, unit: "minute", fetch: "15", bucket: 45 * MIN, lookback: 120, intraday: true },

  { id: "1h",  group: "hours",   n: 1,  unit: "hour",   fetch: "30", bucket: HOUR,     lookback: 180, intraday: true },
  { id: "2h",  group: "hours",   n: 2,  unit: "hour",   fetch: "30", bucket: 2 * HOUR, lookback: 300, intraday: true },
  { id: "4h",  group: "hours",   n: 4,  unit: "hour",   fetch: "30", bucket: 4 * HOUR, lookback: 400, intraday: true },

  { id: "1D",  group: "days",    n: 1,  unit: "day",    fetch: "1D", lookback: 400,  intraday: false },
  { id: "1W",  group: "days",    n: 1,  unit: "week",   fetch: "1W", lookback: 1800, intraday: false },
  { id: "1M",  group: "days",    n: 1,  unit: "month",  fetch: "1D", months: 1,  lookback: 3600, intraday: false },
  { id: "3M",  group: "days",    n: 3,  unit: "month",  fetch: "1D", months: 3,  lookback: 3600, intraday: false },
  { id: "6M",  group: "days",    n: 6,  unit: "month",  fetch: "1D", months: 6,  lookback: 3600, intraday: false },
  { id: "12M", group: "days",    n: 1,  unit: "year",   fetch: "1D", months: 12, lookback: 3600, intraday: false },
];

export const DEFAULT_TF = "1D";

const BY_ID = new Map(TIMEFRAMES.map((t) => [t.id, t]));

/** Native minute resolutions, largest first. */
const NATIVE_MINUTES = [30, 15, 5, 3, 1];

/** Custom intervals are capped so one URL cannot ask the feed for a decade of minutes. */
export const CUSTOM_MAX = { minute: 720, hour: 24, day: 200 } as const;

/**
 * An interval the reader typed that is not in the table — "7 minutes", "9 hours".
 *
 * A custom interval is only honest if we can aggregate it EXACTLY: the bucket
 * must be a whole multiple of a resolution the feed actually serves, or the
 * bars would be stitched from partial source candles and quietly wrong. Every
 * minute count divides by 1, so the fallback always exists; larger counts pick
 * the coarsest divisor to keep the fetch small.
 */
export function parseCustom(id: string): Timeframe | null {
  const m = id.match(/^(\d{1,4})(m|h|D)$/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isInteger(n) || n < 1) return null;

  if (m[2] === "m") {
    if (n > CUSTOM_MAX.minute) return null;
    const fetchMin = NATIVE_MINUTES.find((r) => n % r === 0) ?? 1;
    return {
      id, group: "minutes", n, unit: "minute",
      fetch: String(fetchMin) as FeedResolution,
      bucket: n * MIN,
      lookback: Math.min(400, Math.max(5, Math.ceil(n * 2))),
      intraday: true,
    };
  }
  if (m[2] === "h") {
    if (n > CUSTOM_MAX.hour) return null;
    return {
      id, group: "hours", n, unit: "hour",
      fetch: "30", bucket: n * HOUR,
      lookback: Math.min(800, Math.max(30, n * 100)),
      intraday: true,
    };
  }
  if (n > CUSTOM_MAX.day) return null;
  return {
    id, group: "days", n, unit: "day",
    fetch: "1D", bucket: n * 86400,
    lookback: Math.min(3600, Math.max(60, n * 400)),
    intraday: false,
  };
}

/** Whether an id names an interval outside the built-in table. */
export function isCustom(id: string): boolean {
  return !BY_ID.has(id) && parseCustom(id) !== null;
}

/**
 * Resolve a URL parameter to a timeframe. Anything unrecognised falls back to
 * the daily default rather than 404-ing — a mistyped interval should still draw
 * a chart.
 */
export function timeframe(id: string | null | undefined): Timeframe {
  if (!id) return BY_ID.get(DEFAULT_TF)!;
  return BY_ID.get(id) ?? parseCustom(id) ?? BY_ID.get(DEFAULT_TF)!;
}

export const GROUPS: TfGroup[] = ["minutes", "hours", "days"];

export function byGroup(g: TfGroup): Timeframe[] {
  return TIMEFRAMES.filter((t) => t.group === g);
}

/** Vietnam is UTC+7 year-round — no daylight saving to track. */
export const EXCHANGE_OFFSET = 7 * HOUR;
