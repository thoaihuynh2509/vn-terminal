import test from "node:test";
import assert from "node:assert/strict";
import { MIN_PRESET_BARS, RANGE_PRESETS, barsForPreset, presetForBars } from "./ranges.ts";
import type { Bar } from "../types.ts";

const DAY = 86_400;
const NOW = Date.UTC(2026, 5, 15, 3, 0, 0); // 2026-06-15 10:00 ICT

/** `n` daily bars ending today, oldest first. */
function daily(n: number): Bar[] {
  const end = Math.floor(NOW / 1000);
  return Array.from({ length: n }, (_, i) => {
    const t = end - (n - 1 - i) * DAY;
    return { t, o: 10, h: 11, l: 9, c: 10, v: 100 };
  });
}

test("an empty series has no range", () => {
  for (const p of RANGE_PRESETS) assert.equal(barsForPreset([], p, NOW), 0);
});

test("ALL is every bar loaded", () => {
  assert.equal(barsForPreset(daily(400), "ALL", NOW), 400);
});

test("a month covers roughly a month of daily bars", () => {
  // 30 calendar days of consecutive daily bars, inclusive of today.
  assert.equal(barsForPreset(daily(400), "1M", NOW), 31);
});

test("longer presets cover strictly more than shorter ones", () => {
  const bars = daily(800);
  const counts = (["1M", "3M", "6M", "1Y"] as const).map((p) => barsForPreset(bars, p, NOW));
  for (let i = 1; i < counts.length; i++) {
    assert.ok(counts[i] > counts[i - 1], `${counts[i]} should exceed ${counts[i - 1]}`);
  }
});

test("a preset never claims more bars than the feed actually returned", () => {
  // The honest failure: a feed with 400 daily bars cannot show five years, and
  // a count past the end would silently mean "all" while labelling itself "1Y".
  const bars = daily(50);
  assert.equal(barsForPreset(bars, "1Y", NOW), 50);
});

test("a short window still leaves a legible chart", () => {
  // "1 month" on a weekly chart is four bars; a four-candle chart is not one.
  const weekly: Bar[] = Array.from({ length: 100 }, (_, i) => ({
    t: Math.floor(NOW / 1000) - (99 - i) * 7 * DAY, o: 1, h: 1, l: 1, c: 1, v: 1,
  }));
  assert.equal(barsForPreset(weekly, "1M", NOW), MIN_PRESET_BARS);
});

test("YTD counts from the first of January, in exchange local time", () => {
  const bars = daily(400);
  const ytd = barsForPreset(bars, "YTD", NOW);
  // 2026-01-01 to 2026-06-15 inclusive is 166 days of consecutive daily bars.
  assert.equal(ytd, 166);
  assert.ok(ytd < barsForPreset(bars, "1Y", NOW), "YTD in June is shorter than a year");
});

test("YTD on the first trading day of the year is not the whole history", () => {
  const jan2 = Date.UTC(2026, 0, 2, 3, 0, 0);
  const bars = daily(400).map((b, i, all) => ({
    ...b,
    t: Math.floor(jan2 / 1000) - (all.length - 1 - i) * DAY,
  }));
  assert.equal(barsForPreset(bars, "YTD", jan2), MIN_PRESET_BARS, "clamped up to stay legible");
});

test("a bar count maps back to the preset that produced it", () => {
  const bars = daily(400);
  for (const p of RANGE_PRESETS) {
    assert.equal(presetForBars(bars, barsForPreset(bars, p, NOW), NOW), p, p);
  }
});

test("an arbitrary zoom matches no preset rather than mislabelling one", () => {
  // A control showing nothing selected after a wheel-scroll is honest; claiming
  // "3M" for a window the reader zoomed to by hand is not.
  const bars = daily(400);
  assert.equal(presetForBars(bars, 77, NOW), null);
});
