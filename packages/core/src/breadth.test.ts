import test from "node:test";
import assert from "node:assert/strict";
import { alignBreadth, computeBreadth, type Member } from "./breadth.ts";
import type { Bar } from "./types.ts";

const bar = (t: number, c: number): Bar => ({ t, o: c, h: c, l: c, c, v: 1 });
/** A member whose closes are given, one per day starting at t=0. */
const member = (symbol: string, closes: number[]): Member => ({
  symbol,
  bars: closes.map((c, i) => bar(i * 86400, c)),
});

/** `n` flat days then a jump, so SMA(3) is easy to reason about. */
const flatThen = (flat: number, n: number, tail: number[]) =>
  [...Array.from({ length: n }, () => flat), ...tail];

test("no members is no series", () => {
  assert.deepEqual(computeBreadth([]), []);
});

test("a member without enough history is not counted", () => {
  // Two bars cannot have a 20-day average; including it would make the average
  // mean something different on different days.
  assert.deepEqual(computeBreadth([member("A", [10, 11])], 20), []);
});

test("everything above its average reads 100", () => {
  const m = ["A", "B", "C", "D", "E"].map((s) => member(s, flatThen(10, 3, [20])));
  const out = computeBreadth(m, 3, 5);
  assert.equal(out[out.length - 1].pctAbove, 100);
});

test("everything below its average reads 0", () => {
  const m = ["A", "B", "C", "D", "E"].map((s) => member(s, flatThen(10, 3, [5])));
  const out = computeBreadth(m, 3, 5);
  assert.equal(out[out.length - 1].pctAbove, 0);
});

test("a split market reads between the two", () => {
  const up = ["A", "B", "C"].map((s) => member(s, flatThen(10, 3, [20])));
  const down = ["D", "E"].map((s) => member(s, flatThen(10, 3, [5])));
  const out = computeBreadth([...up, ...down], 3, 5);
  assert.equal(out[out.length - 1].pctAbove, 60, "3 of 5");
});

test("advancers and decliners are counted against the previous close", () => {
  const m = [
    ...["A", "B", "C"].map((s) => member(s, flatThen(10, 3, [20]))),
    ...["D", "E"].map((s) => member(s, flatThen(10, 3, [5]))),
  ];
  const last = computeBreadth(m, 3, 5).at(-1)!;
  assert.equal(last.advancers, 3);
  assert.equal(last.decliners, 2);
});

test("a date measured on too few members is dropped, not reported", () => {
  // Two stocks would swing the reading between 0 and 100 and look like signal.
  const out = computeBreadth([member("A", flatThen(10, 3, [20]))], 3, 5);
  assert.deepEqual(out, []);
});

test("the series is ordered oldest first", () => {
  const m = ["A", "B", "C", "D", "E"].map((s) => member(s, [1, 2, 3, 4, 5, 6, 7, 8]));
  const out = computeBreadth(m, 3, 5);
  assert.ok(out.length > 1);
  for (let i = 1; i < out.length; i++) assert.ok(out[i].t > out[i - 1].t);
});

test("breadth is a percentage, so it is always within 0 and 100", () => {
  const m = ["A", "B", "C", "D", "E"].map((s, i) =>
    member(s, Array.from({ length: 30 }, (_, d) => 10 + Math.sin(d + i) * 5)));
  for (const p of computeBreadth(m, 20, 5)) {
    assert.ok(p.pctAbove >= 0 && p.pctAbove <= 100, String(p.pctAbove));
  }
});

test("aligning leaves dates the chart does not show as null", () => {
  // Interpolating would invent a breadth reading for a date it was never
  // measured on.
  const points = [{ t: 0, pctAbove: 50, advancers: 1, decliners: 1, counted: 2 }];
  assert.deepEqual(alignBreadth(points, [bar(0, 1), bar(86400, 1)]), [50, null]);
});
