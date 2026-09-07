import test from "node:test";
import assert from "node:assert/strict";
import { NEAR_PCT, levelsNearPrice } from "./levels.ts";
import type { Drawing } from "../chart/drawings.ts";

const NOW = 1_800_000_000;
const hline = (id: string, price: number): Drawing => ({ id, kind: "hline", price });

test("a level the price has walked up to is reported", () => {
  const near = levelsNearPrice("vnm", [hline("a", 100.5)], 100, NOW);
  assert.equal(near.length, 1);
  assert.equal(near[0].symbol, "VNM");
  assert.equal(near[0].kind, "hline");
  assert.ok(Math.abs(near[0].distancePct - 0.5) < 1e-9);
});

test("a level far from the price is not", () => {
  assert.deepEqual(levelsNearPrice("VNM", [hline("a", 130)], 100, NOW), []);
});

test("the distance is signed, so above and below read differently", () => {
  const [above] = levelsNearPrice("VNM", [hline("a", 100.8)], 100, NOW);
  const [below] = levelsNearPrice("VNM", [hline("b", 99.2)], 100, NOW);
  assert.ok(above.distancePct > 0);
  assert.ok(below.distancePct < 0);
});

test("the boundary is inclusive, so exactly one percent counts", () => {
  assert.equal(levelsNearPrice("VNM", [hline("a", 101)], 100, NOW).length, 1);
  assert.equal(levelsNearPrice("VNM", [hline("a", 101.01)], 100, NOW).length, 0);
});

test("a trend line is evaluated at NOW, not where it was drawn", () => {
  // Rising from 50 at t0 to 100 at t0+100s; at t0+200s it projects to 150.
  const trend: Drawing = { id: "t", kind: "trend", t1: NOW - 200, p1: 50, t2: NOW - 100, p2: 100 };
  assert.equal(levelsNearPrice("VNM", [trend], 50, NOW).length, 0, "not near where it started");
  const near = levelsNearPrice("VNM", [trend], 150, NOW);
  assert.equal(near.length, 1, "near where it is today");
  assert.equal(near[0].kind, "trend");
});

test("constructions with several implied levels are left alone", () => {
  // Reporting one level of a fib or a channel would be us deciding which one
  // the reader meant.
  const fib: Drawing = { id: "f", kind: "fib", t1: 1, p1: 100, t2: 2, p2: 110 };
  const chan: Drawing = { id: "c", kind: "channel", t1: 1, p1: 100, t2: 2, p2: 101, t3: 3, p3: 102 };
  assert.deepEqual(levelsNearPrice("VNM", [fib, chan], 100, NOW), []);
});

test("the nearest level comes first", () => {
  const near = levelsNearPrice(
    "VNM",
    [hline("far", 100.9), hline("close", 100.1), hline("mid", 100.5)],
    100, NOW,
  );
  assert.deepEqual(near.map((n) => n.price), [100.1, 100.5, 100.9]);
});

test("a nonsense price reports nothing rather than dividing by it", () => {
  for (const p of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.deepEqual(levelsNearPrice("VNM", [hline("a", 100)], p, NOW), []);
  }
});

test("a corrupt level is skipped, not reported as zero", () => {
  const bad = [{ id: "a", kind: "hline", price: Number.NaN } as Drawing, hline("b", 100.2)];
  const near = levelsNearPrice("VNM", bad, 100, NOW);
  assert.deepEqual(near.map((n) => n.price), [100.2]);
});

test("the default tolerance is the documented one", () => {
  assert.equal(NEAR_PCT, 1);
});
