import type { Bar } from "@/lib/types";

/**
 * OHLC resampling.
 *
 * Aggregating bars is deceptively easy to get wrong, and wrong aggregation is
 * invisible on a chart until someone trades on it. The rules, in order:
 *
 *   open   = FIRST bar's open   (not the min, not the mean)
 *   high   = MAX of highs
 *   low    = MIN of lows
 *   close  = LAST bar's close
 *   volume = SUM
 *   time   = the bucket's start, so buckets tile the axis evenly
 *
 * Source bars must be ascending by time; the caller's feeds already are.
 *
 * `offsetSeconds` shifts the bucket grid into the exchange's local day. Bucketing
 * a Vietnamese session on the UTC grid puts the 4-hour boundary at 11:00 ICT —
 * the middle of the morning session — so a "4 hour" candle would straddle the
 * lunch break differently every day. Passing the exchange offset (+07:00) makes
 * the boundaries land where a local trader expects them.
 */
export function resample(bars: Bar[], bucketSeconds: number, offsetSeconds = 0): Bar[] {
  if (bucketSeconds <= 0 || bars.length === 0) return bars;

  const out: Bar[] = [];
  let cur: Bar | null = null;
  let curBucket = -1;

  for (const b of bars) {
    const bucket = Math.floor((b.t + offsetSeconds) / bucketSeconds) * bucketSeconds - offsetSeconds;
    if (bucket !== curBucket) {
      if (cur) out.push(cur);
      curBucket = bucket;
      cur = { t: bucket, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v };
      continue;
    }
    // Same bucket: extend it. Open is never touched again.
    cur = {
      t: curBucket,
      o: cur!.o,
      h: Math.max(cur!.h, b.h),
      l: Math.min(cur!.l, b.l),
      c: b.c,
      v: cur!.v + b.v,
    };
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * Intraday buckets, restarted at the start of every local trading day.
 *
 * `resample` lays one grid across the whole epoch, which is right for buckets
 * that divide a day (30m, 1h, 4h) and WRONG for any that do not. A 7-minute
 * grid anchored to the epoch advances five minutes every day — the first bar of
 * the session lands at 09:14, then 09:19, then 09:24 — so the same bar of the
 * session is never the same bar twice and days cannot be compared. Restarting
 * the grid each local midnight gives every day the same phase.
 */
export function resampleIntraday(bars: Bar[], bucketSeconds: number, offsetSeconds = 0): Bar[] {
  if (bucketSeconds <= 0 || bars.length === 0) return bars;
  const DAY = 86400;

  const out: Bar[] = [];
  let cur: Bar | null = null;
  let curKey = "";

  for (const b of bars) {
    const local = b.t + offsetSeconds;
    const dayStart = Math.floor(local / DAY) * DAY;
    const slot = Math.floor((local - dayStart) / bucketSeconds);
    const key = `${dayStart}:${slot}`;
    if (key !== curKey) {
      if (cur) out.push(cur);
      curKey = key;
      cur = { t: dayStart + slot * bucketSeconds - offsetSeconds, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v };
      continue;
    }
    cur = { t: cur!.t, o: cur!.o, h: Math.max(cur!.h, b.h), l: Math.min(cur!.l, b.l), c: b.c, v: cur!.v + b.v };
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * Calendar-month buckets, which are not a fixed number of seconds and so cannot
 * go through `resample`. A 30-day bucket would drift across the year.
 *
 * `months` groups several calendar months into one bar (3 = quarters, 12 = years)
 * counting from January, so quarters are Jan-Mar / Apr-Jun and not an arbitrary
 * three months measured from whenever the series happens to start.
 */
export function resampleMonthly(bars: Bar[], months = 1): Bar[] {
  if (!bars.length) return bars;
  const out: Bar[] = [];
  let cur: Bar | null = null;
  let key = "";

  for (const b of bars) {
    const d = new Date(b.t * 1000);
    const m = Math.floor(d.getUTCMonth() / months) * months;
    const k = `${d.getUTCFullYear()}-${m}`;
    if (k !== key) {
      if (cur) out.push(cur);
      key = k;
      cur = { t: Math.floor(Date.UTC(d.getUTCFullYear(), m, 1) / 1000), o: b.o, h: b.h, l: b.l, c: b.c, v: b.v };
      continue;
    }
    cur = { t: cur!.t, o: cur!.o, h: Math.max(cur!.h, b.h), l: Math.min(cur!.l, b.l), c: b.c, v: cur!.v + b.v };
  }
  if (cur) out.push(cur);
  return out;
}
