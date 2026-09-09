import assert from "node:assert/strict";
import test from "node:test";
import { FREE_ASK_LIMIT, freeAsksLeft, freeAsksToShow } from "./meter.ts";

test("a subscriber has no meter at all", () => {
  for (const t of ["plus", "pro"] as const) {
    assert.equal(freeAsksLeft(t, 0, true), null);
    // Asks counted before they subscribed must not follow them over the line.
    assert.equal(freeAsksLeft(t, 99, true), null);
  }
});

test("a non-entitled reader spends the taste one ask at a time", () => {
  assert.equal(freeAsksLeft("anon", 0, true), FREE_ASK_LIMIT);
  assert.equal(freeAsksLeft("anon", 1, true), FREE_ASK_LIMIT - 1);
  assert.equal(freeAsksLeft("anon", FREE_ASK_LIMIT, true), 0);
  assert.equal(freeAsksLeft("free", 0, true), FREE_ASK_LIMIT);
});

test("an undefined count is a reader who has never asked", () => {
  assert.equal(freeAsksLeft("anon", undefined, true), FREE_ASK_LIMIT);
});

test("a count past the limit reads as spent, never as credit", () => {
  assert.equal(freeAsksLeft("anon", FREE_ASK_LIMIT + 5, true), 0);
  assert.equal(freeAsksLeft("anon", Number.MAX_SAFE_INTEGER, true), 0);
});

test("a nonsense count is treated as nothing spent, not as a crash", () => {
  for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY * 0]) {
    assert.equal(freeAsksLeft("anon", bad, true), FREE_ASK_LIMIT);
  }
  assert.equal(freeAsksLeft("anon", 1.7, true), FREE_ASK_LIMIT - 1, "a fractional count floors");
});

test("without a place to keep the count there is no free taste", () => {
  assert.equal(freeAsksLeft("anon", 0, false), 0);
  assert.equal(freeAsksLeft("plus", 0, false), null, "a subscriber never depended on the meter");
});

test("what to SHOW and what to ALLOW agree everywhere except the unkeyed case", () => {
  for (const t of ["anon", "free", "plus", "pro"] as const) {
    for (const n of [0, 1, 2, 3]) {
      assert.equal(freeAsksToShow(t, n, true), freeAsksLeft(t, n, true), `${t}/${n} metered`);
    }
  }
});

/**
 * Enforcement must refuse without a signing secret; the surface must not turn
 * that refusal into a missing feature. `.env.example` ships AUTH_SECRET empty,
 * so this is the default state of every fresh checkout, not a rare edge.
 */
test("with no secret the box still shows, and the server still refuses", () => {
  assert.equal(freeAsksLeft("anon", 0, false), 0, "the route refuses");
  assert.equal(freeAsksToShow("anon", 0, false), null, "the surface shows no meter, not a wall");
  assert.equal(freeAsksToShow("plus", 0, false), null);
});
