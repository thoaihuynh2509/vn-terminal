/** TradingView's bottom-toolbar ranges: each picks the interval it is drawn at and how far back it shows. */
export const TV_RANGES = ["1D", "5D", "1M", "3M", "6M", "YTD", "1Y", "5Y", "ALL"] as const;
export type TvRange = (typeof TV_RANGES)[number];

export function isTvRange(v: unknown): v is TvRange {
  return typeof v === "string" && (TV_RANGES as readonly string[]).includes(v);
}

type Back = { sessions: number } | { seconds: number } | "ytd" | "all";

export interface RangeView {
  /** The interval the range is drawn at, or null to keep the one on screen. */
  tf: string | null;
  back: Back;
}

const DAY = 86_400;
const ICT = 7 * 3600;
/** Below this a chart is a handful of candles and a meaningless scale. */
export const MIN_RANGE_BARS = 20;

const BACK: Record<TvRange, Back> = {
  "1D": { sessions: 1 }, "5D": { sessions: 5 },
  "1M": { seconds: 31 * DAY }, "3M": { seconds: 92 * DAY }, "6M": { seconds: 183 * DAY },
  YTD: "ytd", "1Y": { seconds: 366 * DAY }, "5Y": { seconds: 5 * 366 * DAY }, ALL: "all",
};

/** The interval and span for a range, or null when it needs intraday bars the tier does not have. */
export function rangeView(range: TvRange, intraday: boolean): RangeView | null {
  const back = BACK[range];
  switch (range) {
    case "1D": return intraday ? { tf: "5m", back } : null;
    case "5D": return intraday ? { tf: "15m", back } : null;
    case "1M": return { tf: intraday ? "1h" : "1D", back };
    case "5Y": return { tf: "1W", back };
    case "ALL": return { tf: null, back };
    default: return { tf: "1D", back };
  }
}

/** The first second of the year of `nowSec`, in Ho Chi Minh time, for YTD. */
export function yearStart(nowSec: number): number {
  const y = new Date((nowSec + ICT) * 1000).getUTCFullYear();
  return Date.UTC(y, 0, 1) / 1000 - ICT;
}

const ictDay = (t: number) => Math.floor((t + ICT) / DAY);

/**
 * How many of the newest bars a range covers, counted back from the newest bar rather than the clock,
 * so a weekend or a stale feed still shows the last sessions it has.
 */
export function barsForRange(bars: readonly { t: number }[], range: TvRange): number {
  const n = bars.length;
  if (!n) return 0;
  const back = BACK[range];
  if (back === "all") return n;
  const newest = bars[n - 1].t;
  let first: number;
  if (back === "ytd" || "seconds" in back) {
    const cutoff = back === "ytd" ? yearStart(newest) : newest - back.seconds;
    first = bars.findIndex((b) => b.t >= cutoff);
    if (first === -1) first = n - 1;
  } else {
    let days = 0, day = Number.NaN;
    first = n;
    for (let i = n - 1; i >= 0; i--) {
      const d = ictDay(bars[i].t);
      if (d !== day) {
        if (days === back.sessions) break;
        days++;
        day = d;
      }
      first = i;
    }
  }
  return Math.min(n, Math.max(MIN_RANGE_BARS, n - first));
}

/** The range a window matches on the interval on screen; null for a zoom that lands between ranges. */
export function rangeForCount(bars: readonly { t: number }[], count: number, tf: string, intraday: boolean): TvRange | null {
  return TV_RANGES.find((r) => {
    const v = rangeView(r, intraday);
    return !!v && (v.tf === null || v.tf === tf) && barsForRange(bars, r) === count;
  }) ?? null;
}
