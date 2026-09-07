import test from "node:test";
import assert from "node:assert/strict";
import { LINK_TOLERANCE, barSpacing, linkedIndex } from "./sync.ts";
import type { Bar } from "../types.ts";

const DAY = 86_400;
/** Daily bars starting at `from`, skipping nothing. */
const days = (n: number, from = 0): Bar[] =>
  Array.from({ length: n }, (_, i) => ({ t: from + i * DAY, o: 1, h: 1, l: 1, c: 1, v: 1 }));

test("a hovered moment finds the bar it falls on", () => {
  const bars = days(10);
  assert.equal(linkedIndex(bars, 3 * DAY), 3);
  assert.equal(linkedIndex(bars, 0), 0);
  assert.equal(linkedIndex(bars, 9 * DAY), 9);
});

test("a moment inside a bar resolves to that bar", () => {
  const bars = days(10);
  assert.equal(linkedIndex(bars, 3 * DAY + DAY / 4), 3);
  assert.equal(linkedIndex(bars, 3 * DAY - DAY / 4), 3);
});

test("linking is by time, so different histories still line up", () => {
  // The whole point: two symbols do not have the same bars, and bar 40 of one
  // is routinely a different day from bar 40 of the other.
  const long = days(100);              // starts at t=0
  const short = days(60, 40 * DAY);    // listed later
  const t = long[70].t;
  assert.equal(linkedIndex(long, t), 70);
  assert.equal(linkedIndex(short, t), 30);
  assert.equal(long[70].t, short[30].t);
});

test("a companion with no bar at that moment shows nothing", () => {
  // A crosshair parked on whatever bar is nearest puts a wrong number in the
  // read-out beside it.
  const halted = [...days(5), ...days(5, 30 * DAY)];
  assert.equal(linkedIndex(halted, 15 * DAY), null);
});

test("a moment before or after the whole series links to nothing", () => {
  const bars = days(10);
  assert.equal(linkedIndex(bars, -10 * DAY), null);
  assert.equal(linkedIndex(bars, 40 * DAY), null);
});

test("no hover means no linked bar", () => {
  assert.equal(linkedIndex(days(10), null), null);
  assert.equal(linkedIndex(days(10), NaN), null);
});

test("an empty companion is safe", () => {
  assert.equal(linkedIndex([], 5 * DAY), null);
});

test("a single-bar companion links only on a near-exact hit", () => {
  const one = days(1);
  assert.equal(linkedIndex(one, 0), 0);
  assert.equal(linkedIndex(one, DAY), null);
});

test("spacing is the median, so weekends do not smear it", () => {
  // A mean would be pulled up by every three-day weekend gap and widen the
  // tolerance enough to match the wrong session.
  const bars: Bar[] = [];
  for (let i = 0; i < 20; i++) {
    const gap = i % 5 === 0 ? 3 * DAY : DAY;
    bars.push({ t: (bars[i - 1]?.t ?? 0) + (i ? gap : 0), o: 1, h: 1, l: 1, c: 1, v: 1 });
  }
  assert.equal(barSpacing(bars), DAY);
});

test("spacing scales the tolerance, so the rule holds at any interval", () => {
  const minute = Array.from({ length: 10 }, (_, i) => ({ t: i * 60, o: 1, h: 1, l: 1, c: 1, v: 1 }));
  // Half a minute lands inside the bar; ten minutes is nowhere near one.
  assert.equal(linkedIndex(minute, 5 * 60 + 20), 5);
  assert.equal(linkedIndex(minute, 600 + 300), null);
});

test("the tolerance is under a full bar, so a gap cannot be bridged", () => {
  assert.ok(LINK_TOLERANCE < 1);
});

test("spacing of a degenerate series is zero rather than NaN", () => {
  assert.equal(barSpacing([]), 0);
  assert.equal(barSpacing(days(1)), 0);
});
