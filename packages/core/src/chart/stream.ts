/**
 * Live bar updates, behind a seam.
 *
 * The chart's only live behaviour today is `LiveStamp` calling `router.refresh`
 * every 30 seconds during session hours, which re-renders the whole page to move
 * one candle. This replaces that with a targeted update, and — the reason it is
 * shaped as an interface rather than a fetch — it is the seam a paid realtime
 * feed plugs into later without the chart changing at all.
 *
 * The honest part is `latency`. An adapter states what it can actually deliver,
 * and the header shows that rather than a green dot implying realtime over a
 * feed that is nothing of the sort.
 *
 * Pure fold, testable without a network or a clock.
 */
import type { Bar } from "../types.ts";

export type LatencyClass = "eod" | "delayed" | "realtime";

export interface BarUpdate {
  symbol: string;
  tf: string;
  bar: Bar;
  /** Whether the bar is closed. An open bar keeps being replaced. */
  final: boolean;
}

export interface BarStream {
  readonly kind: "poll" | "sse";
  readonly latency: LatencyClass;
  subscribe(symbol: string, tf: string, onUpdate: (u: BarUpdate) => void): () => void;
}

/**
 * Fold one update into the loaded series.
 *
 * Three cases, and the third is the one that matters: a bar OLDER than the last
 * one held is ignored. Polling can and does return a stale response after a
 * fresher one — a slow request that started earlier finishing later — and
 * applying it would make the chart jump backwards.
 *
 * The bucket is passed rather than inferred so a 5-minute chart and a daily
 * chart use the same code without either guessing the other's interval.
 */
export function applyUpdate(bars: Bar[], u: BarUpdate, bucketSec: number): Bar[] {
  if (!bars.length) return [u.bar];
  if (!Number.isFinite(u.bar.t) || u.bar.t <= 0) return bars;

  const last = bars[bars.length - 1];
  const bucket = Math.max(1, bucketSec);
  const sameBucket = Math.floor(u.bar.t / bucket) === Math.floor(last.t / bucket);

  if (sameBucket) {
    // The current bar is still forming: replace it, but keep the extremes it
    // has already printed. A poll only sees the price NOW, so trusting its high
    // and low would erase a spike that happened between two polls.
    const merged: Bar = {
      ...u.bar,
      o: last.o,
      h: Math.max(last.h, u.bar.h, u.bar.c),
      l: Math.min(last.l, u.bar.l, u.bar.c),
      v: Math.max(last.v, u.bar.v),
    };
    return [...bars.slice(0, -1), merged];
  }
  if (u.bar.t > last.t) return [...bars, u.bar];
  return bars;
}

/** How stale the data is allowed to look before the badge stops claiming live. */
export const POLL_INTERVAL_MS = 30_000;

/**
 * A stream built from the bars API.
 *
 * Free for everyone and honest about what it is: `delayed`, because a 30-second
 * poll of an end-of-minute feed is not realtime and a badge saying otherwise
 * would be the kind of promise this codebase keeps deleting from the pricing
 * page.
 */
export function pollStream(
  fetchBars: (symbol: string, tf: string) => Promise<Bar[]>,
  { intervalMs = POLL_INTERVAL_MS, isOpen = () => true }: {
    intervalMs?: number;
    /** Only poll while the market is open; off-hours nothing changes. */
    isOpen?: () => boolean;
  } = {},
): BarStream {
  return {
    kind: "poll",
    latency: "delayed",
    subscribe(symbol, tf, onUpdate) {
      let stopped = false;
      const tick = async () => {
        if (stopped || !isOpen()) return;
        try {
          const bars = await fetchBars(symbol, tf);
          if (stopped || !bars.length) return;
          onUpdate({ symbol, tf, bar: bars[bars.length - 1], final: false });
        } catch {
          /* a failed poll is a missed tick, never an error the reader sees */
        }
      };
      const timer = setInterval(tick, intervalMs);
      void tick();
      return () => { stopped = true; clearInterval(timer); };
    },
  };
}

/**
 * Whether a polled bar says anything new.
 *
 * Between trades a poll returns the forming bar unchanged. Treating that as a
 * new bar re-derived the whole series — and with it every indicator, which is
 * computed over the full history — every 30 seconds, to draw the same pixels.
 */
export function sameBar(a: Bar, b: Bar): boolean {
  return a.t === b.t && a.o === b.o && a.h === b.h && a.l === b.l && a.c === b.c && a.v === b.v;
}
