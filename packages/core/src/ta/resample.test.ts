import assert from "node:assert/strict";
import test from "node:test";
import { resample, resampleIntraday, resampleMonthly } from "./resample.ts";
import type { Bar } from "@/lib/types";

const b = (t: number, o: number, h: number, l: number, c: number, v = 10): Bar => ({ t, o, h, l, c, v });
const MIN = 60;

test("open comes from the first bar and close from the last", () => {
  const src = [b(0, 10, 12, 9, 11), b(MIN, 11, 15, 8, 14), b(2 * MIN, 14, 16, 13, 13)];
  const [agg] = resample(src, 5 * MIN);
  assert.equal(agg.o, 10, "open must be the FIRST open, not a min or mean");
  assert.equal(agg.c, 13, "close must be the LAST close");
});

test("high is the max and low is the min across the bucket", () => {
  const src = [b(0, 10, 12, 9, 11), b(MIN, 11, 15, 8, 14), b(2 * MIN, 14, 16, 13, 13)];
  const [agg] = resample(src, 5 * MIN);
  assert.equal(agg.h, 16);
  assert.equal(agg.l, 8);
});

test("volume sums", () => {
  const src = [b(0, 1, 1, 1, 1, 5), b(MIN, 1, 1, 1, 1, 7)];
  assert.equal(resample(src, 5 * MIN)[0].v, 12);
});

test("bucket timestamps are aligned to the interval, not to the first bar", () => {
  // A bar at 07:03 belongs to the 07:00 bucket; otherwise buckets drift.
  const src = [b(3 * MIN, 1, 1, 1, 1), b(4 * MIN, 1, 1, 1, 1)];
  const [agg] = resample(src, 5 * MIN);
  assert.equal(agg.t, 0, "expected the aligned bucket start");
});

test("bars in different buckets stay separate", () => {
  const src = [b(0, 1, 1, 1, 1), b(5 * MIN, 2, 2, 2, 2), b(10 * MIN, 3, 3, 3, 3)];
  assert.equal(resample(src, 5 * MIN).length, 3);
});

test("aggregating never invents or loses a session's extremes", () => {
  const src = Array.from({ length: 60 }, (_, i) => b(i * MIN, 100 + i, 105 + i, 95 + i, 100 + i));
  const agg = resample(src, 15 * MIN);
  assert.equal(agg.length, 4);
  assert.equal(Math.max(...agg.map((x) => x.h)), Math.max(...src.map((x) => x.h)));
  assert.equal(Math.min(...agg.map((x) => x.l)), Math.min(...src.map((x) => x.l)));
  assert.equal(agg.reduce((s, x) => s + x.v, 0), src.reduce((s, x) => s + x.v, 0));
});

test("resampling to the same interval is a no-op in substance", () => {
  const src = [b(0, 1, 2, 0, 1), b(MIN, 2, 3, 1, 2)];
  const agg = resample(src, MIN);
  assert.equal(agg.length, 2);
  assert.deepEqual(agg.map((x) => [x.o, x.h, x.l, x.c]), src.map((x) => [x.o, x.h, x.l, x.c]));
});

test("degenerate inputs are returned untouched", () => {
  assert.deepEqual(resample([], 60), []);
  const one = [b(0, 1, 1, 1, 1)];
  assert.deepEqual(resample(one, 0), one, "a zero bucket must not divide by zero");
});

test("monthly buckets follow the calendar, not a fixed 30 days", () => {
  const jan = Math.floor(Date.UTC(2026, 0, 5) / 1000);
  const jan2 = Math.floor(Date.UTC(2026, 0, 28) / 1000);
  const feb = Math.floor(Date.UTC(2026, 1, 3) / 1000);
  const agg = resampleMonthly([b(jan, 10, 11, 9, 10), b(jan2, 10, 20, 5, 18), b(feb, 18, 19, 17, 19)]);
  assert.equal(agg.length, 2, "January and February must not merge");
  assert.equal(agg[0].o, 10);
  assert.equal(agg[0].c, 18);
  assert.equal(agg[0].h, 20);
  assert.equal(agg[0].l, 5);
  assert.equal(agg[0].t, Math.floor(Date.UTC(2026, 0, 1) / 1000), "bucket starts on the 1st");
});

test("bucket boundaries follow the exchange offset, not UTC", () => {
  const ICT = 7 * 3600;
  // The HOSE morning session runs 09:00-11:30 ICT, which is one 08:00-12:00 local
  // bucket. On the UTC grid that span crosses the 04:00 boundary (01:00 and 04:30
  // UTC), so a UTC-bucketed "4 hour" candle cuts the morning session in half.
  const open = Math.floor(Date.UTC(2026, 8, 1, 2, 0) / 1000);   // 09:00 +07 = 02:00Z
  const close = Math.floor(Date.UTC(2026, 8, 1, 4, 30) / 1000); // 11:30 +07 = 04:30Z
  const src = [b(open, 10, 12, 9, 11), b(close, 11, 13, 10, 12)];

  assert.equal(resample(src, 4 * 3600, ICT).length, 1, "one morning bucket");
  assert.equal(resample(src, 4 * 3600, 0).length, 2, "UTC grid splits the session — the bug this guards");

  const [agg] = resample(src, 4 * 3600, ICT);
  const start = new Date(agg.t * 1000);
  assert.equal((start.getUTCHours() + 7) % 24, 8, "bucket starts at 08:00 local");
});

test("quarters are calendar quarters counted from January", () => {
  const at = (m: number, d: number) => Math.floor(Date.UTC(2026, m, d) / 1000);
  // Series starts in February. Quarters must still break at Mar|Apr, not Apr|May.
  const agg = resampleMonthly(
    [b(at(1, 10), 1, 1, 1, 1), b(at(2, 10), 2, 2, 2, 2), b(at(3, 10), 3, 3, 3, 3)],
    3,
  );
  assert.equal(agg.length, 2, "Feb+Mar are Q1; Apr opens Q2");
  assert.equal(agg[0].t, Math.floor(Date.UTC(2026, 0, 1) / 1000), "Q1 is stamped January");
  assert.equal(agg[1].t, Math.floor(Date.UTC(2026, 3, 1) / 1000), "Q2 is stamped April");
});

test("twelve-month buckets are calendar years", () => {
  const at = (y: number, m: number) => Math.floor(Date.UTC(y, m, 15) / 1000);
  const agg = resampleMonthly([b(at(2025, 5), 1, 1, 1, 1), b(at(2025, 11), 2, 2, 2, 2), b(at(2026, 0), 3, 3, 3, 3)], 12);
  assert.equal(agg.length, 2);
  assert.equal(agg[0].c, 2, "both 2025 bars fold into one year");
});

test("an intraday grid restarts each day, so every session has the same phase", () => {
  const ICT = 7 * 3600;
  const BUCKET = 7 * 60; // 7 does not divide a day — the drifting case
  // The same two clock times on three consecutive days.
  const at = (day: number, h: number, m: number) =>
    Math.floor(Date.UTC(2026, 8, day, h - 7, m) / 1000);

  const src = [];
  for (const day of [1, 2, 3]) {
    for (const m of [15, 22, 29, 36]) src.push(b(at(day, 9, m), 10, 11, 9, 10));
  }
  const agg = resampleIntraday(src, BUCKET, ICT);

  // Take the first bucket of each day and confirm they share a clock time.
  const clock = (t: number) => {
    const d = new Date((t + ICT) * 1000);
    return `${d.getUTCHours()}:${d.getUTCMinutes()}`;
  };
  const firsts = [];
  let seen = "";
  for (const bar of agg) {
    const day = new Date((bar.t + ICT) * 1000).getUTCDate();
    if (String(day) !== seen) { seen = String(day); firsts.push(clock(bar.t)); }
  }
  assert.equal(firsts.length, 3, "three trading days");
  assert.equal(new Set(firsts).size, 1, `sessions drifted: ${firsts.join(" ")}`);

  // The epoch-anchored grid is exactly what drifts — this is the bug it replaces.
  const drifted = resample(src, BUCKET, ICT);
  const dFirsts = [];
  seen = "";
  for (const bar of drifted) {
    const day = new Date((bar.t + ICT) * 1000).getUTCDate();
    if (String(day) !== seen) { seen = String(day); dFirsts.push(clock(bar.t)); }
  }
  assert.ok(new Set(dFirsts).size > 1, "expected the epoch grid to drift across days");
});

test("intraday regrouping still aggregates OHLCV correctly", () => {
  const ICT = 7 * 3600;
  const at = (h: number, m: number) => Math.floor(Date.UTC(2026, 8, 1, h - 7, m) / 1000);
  const agg = resampleIntraday(
    [b(at(9, 15), 10, 12, 9, 11, 5), b(at(9, 18), 11, 15, 8, 14, 7)],
    7 * 60, ICT,
  );
  assert.equal(agg.length, 1);
  assert.equal(agg[0].o, 10);
  assert.equal(agg[0].c, 14);
  assert.equal(agg[0].h, 15);
  assert.equal(agg[0].l, 8);
  assert.equal(agg[0].v, 12);
});
