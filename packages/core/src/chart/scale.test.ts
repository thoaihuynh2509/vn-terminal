import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SCALE, SCALES, denorm, effectiveScale, isScale, norm, padRange, pctOf,
  scaleTicks, usable,
} from "./scale.ts";

const close = (a: number, b: number, eps = 1e-9) =>
  assert.ok(Math.abs(a - b) < eps, `${a} !== ${b}`);

test("the ends of the axis are the ends of the range", () => {
  for (const id of SCALES) {
    close(norm(id, 10, 10, 100), 0);
    close(norm(id, 100, 10, 100), 1);
  }
});

test("equal percentage moves are equal distances on a log axis", () => {
  // The whole reason to offer one: 10 to 20 doubled a holding, 100 to 110 added
  // a tenth, and a linear axis draws the second as the larger move.
  const a = norm("log", 20, 10, 1000) - norm("log", 10, 10, 1000);
  const b = norm("log", 200, 10, 1000) - norm("log", 100, 10, 1000);
  close(a, b, 1e-12);
});

test("a linear axis makes the same two moves unequal", () => {
  const a = norm("lin", 20, 10, 1000) - norm("lin", 10, 10, 1000);
  const b = norm("lin", 200, 10, 1000) - norm("lin", 100, 10, 1000);
  assert.ok(b > a * 5, "linear should exaggerate the larger absolute move");
});

test("percent geometry is identical to linear", () => {
  // Percent change is a strictly increasing linear function of price, so only
  // the LABELS differ. Different geometry would move bars for no reason.
  for (const v of [10, 42.5, 99]) close(norm("pct", v, 10, 100), norm("lin", v, 10, 100));
});

test("mapping a price to the axis and back returns the price", () => {
  for (const id of SCALES) {
    for (const v of [10.5, 33, 87.25]) {
      close(denorm(id, norm(id, v, 10, 100), 10, 100), v, 1e-9);
    }
  }
});

test("a degenerate range sits in the middle rather than dividing by zero", () => {
  for (const id of SCALES) close(norm(id, 50, 50, 50), 0.5);
});

test("percent change is signed and relative to the baseline", () => {
  close(pctOf(110, 100), 10);
  close(pctOf(90, 100), -10);
  close(pctOf(100, 100), 0);
});

test("a log axis is refused when the data cannot support one", () => {
  // A series touching zero or negative has no logarithm; drawing a broken axis
  // would be worse than ignoring the reader's choice.
  assert.equal(usable("log", 0, 100, 50), false);
  assert.equal(usable("log", -5, 100, 50), false);
  assert.equal(effectiveScale("log", 0, 100, 50), "lin");
  assert.equal(effectiveScale("log", 1, 100, 50), "log");
});

test("a percent axis is refused without a usable baseline", () => {
  assert.equal(effectiveScale("pct", 10, 100, 0), "lin");
  assert.equal(effectiveScale("pct", 10, 100, NaN), "lin");
  assert.equal(effectiveScale("pct", 10, 100, 42), "pct");
});

test("a linear axis is always usable", () => {
  assert.equal(effectiveScale("lin", 10, 100, 0), "lin");
  assert.equal(usable("lin", -50, 50, 0), true);
});

test("non-finite bounds fall back rather than producing NaN pixels", () => {
  assert.equal(effectiveScale("log", NaN, 100, 1), "lin");
  assert.equal(effectiveScale("lin", 10, Infinity, 1), "lin");
});

test("log ticks are evenly spaced on screen, not in price", () => {
  // Evenly spaced PRICES on a log axis bunch every label at the top.
  const ticks = scaleTicks("log", 1, 10000, 4);
  const positions = ticks.map((t) => norm("log", t, 1, 10000));
  for (let i = 1; i < positions.length; i++) {
    close(positions[i] - positions[i - 1], 0.25, 1e-9);
  }
});

test("linear ticks span the range evenly", () => {
  assert.deepEqual(scaleTicks("lin", 0, 100, 4), [0, 25, 50, 75, 100]);
});

test("ticks start and end exactly on the range", () => {
  for (const id of SCALES) {
    const t = scaleTicks(id, 12, 88, 5);
    close(t[0], 12, 1e-9);
    close(t[t.length - 1], 88, 1e-9);
  }
});

test("a flat range yields one tick rather than a divide by zero", () => {
  assert.deepEqual(scaleTicks("lin", 7, 7), [7]);
  assert.deepEqual(scaleTicks("log", 7, 7), [7]);
});

test("log padding is multiplicative, so it does not tilt the series", () => {
  // Additive padding on a log range pads the bottom far more in percentage
  // terms — the exact distortion a log axis exists to remove.
  const { min, max } = padRange("log", 10, 1000, 0.1);
  close(min, 10 / 1.1, 1e-9);
  close(max, 1000 * 1.1, 1e-9);
  assert.ok(min > 0, "padding must never push a log axis to zero");
});

test("linear padding is additive and symmetric", () => {
  const { min, max } = padRange("lin", 10, 20, 0.1);
  close(min, 9);
  close(max, 21);
});

test("a flat linear range still gets a usable band", () => {
  const { min, max } = padRange("lin", 50, 50);
  assert.ok(max > min, "a flat series must not collapse the axis");
});

test("only the three known scales are accepted", () => {
  assert.ok(isScale("lin") && isScale("log") && isScale("pct"));
  assert.ok(!isScale("renko") && !isScale("") && !isScale(null));
  assert.equal(DEFAULT_SCALE, "lin");
});
