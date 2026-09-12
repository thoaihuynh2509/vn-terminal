import { test } from "node:test";
import assert from "node:assert/strict";
import { MIN_RANGE_BARS, barsForRange, isTvRange, rangeForCount, rangeView, yearStart } from "./range-interval.ts";

const DAY = 86_400;
/** `days` sessions of 5-minute bars from 09:15 to 14:45 Ho Chi Minh time. */
function sessions(days: number) {
  const out: { t: number }[] = [];
  const open = Date.parse("2026-09-07T02:15:00Z") / 1000;
  for (let d = 0; d < days; d++) for (let m = 0; m <= 330; m += 5) out.push({ t: open + d * DAY + m * 60 });
  return out;
}
const daily = (n: number) => Array.from({ length: n }, (_, i) => ({ t: Date.parse("2024-01-01T02:00:00Z") / 1000 + i * DAY }));

test("short ranges draw at intraday intervals for a tier that has them", () => {
  assert.equal(rangeView("1D", true)?.tf, "5m");
  assert.equal(rangeView("5D", true)?.tf, "15m");
  assert.equal(rangeView("1M", true)?.tf, "1h");
});

test("a tier without intraday is not offered the session ranges, and a month stays daily", () => {
  assert.equal(rangeView("1D", false), null);
  assert.equal(rangeView("5D", false), null);
  assert.equal(rangeView("1M", false)?.tf, "1D");
});

test("five years steps up to weekly bars; everything keeps the interval on screen", () => {
  assert.equal(rangeView("5Y", true)?.tf, "1W");
  assert.equal(rangeView("ALL", true)?.tf, null);
});

test("one day is the newest session, however long ago it was", () => {
  const bars = sessions(3);
  assert.equal(barsForRange(bars, "1D"), 67);
  assert.equal(barsForRange(bars, "5D"), bars.length);
});

test("a range never shrinks the chart to a handful of candles", () => {
  assert.equal(barsForRange(daily(400), "1D"), MIN_RANGE_BARS);
  assert.equal(barsForRange(daily(5), "1D"), 5);
  assert.equal(barsForRange([], "1Y"), 0);
});

test("calendar ranges count back from the newest bar", () => {
  const bars = daily(800);
  assert.equal(barsForRange(bars, "3M"), 93);
  assert.equal(barsForRange(bars, "ALL"), 800);
  const newest = bars[bars.length - 1].t;
  assert.equal(barsForRange(bars, "YTD"), bars.filter((b) => b.t >= yearStart(newest)).length);
});

test("the lit range is the one whose window is on screen, and none between them", () => {
  const bars = daily(800);
  assert.equal(rangeForCount(bars, 93, "1D", true), "3M");
  assert.equal(rangeForCount(bars, 800, "1D", true), "ALL");
  assert.equal(rangeForCount(bars, 94, "1D", true), null);
  // Three months is drawn on daily bars, so on an hourly chart the same count means nothing.
  assert.equal(rangeForCount(bars, 93, "1h", true), null);
});

test("only the toolbar's own ranges are ranges", () => {
  assert.ok(isTvRange("5Y"));
  assert.ok(!isTvRange("2Y"));
  assert.ok(!isTvRange(undefined));
});

test("YTD counts from the first of January in market time", () => {
  const t = Date.parse("2026-09-12T03:00:00Z") / 1000;
  assert.equal(yearStart(t), Date.parse("2025-12-31T17:00:00Z") / 1000);
  // 18:00 UTC on 31 Dec is already the new year in Ho Chi Minh City.
  assert.equal(yearStart(Date.parse("2026-12-31T18:00:00Z") / 1000), Date.parse("2026-12-31T17:00:00Z") / 1000);
});
