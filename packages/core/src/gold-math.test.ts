import assert from "node:assert/strict";
import test from "node:test";
import { GRAMS_PER_LUONG, GRAMS_PER_TROY_OZ, OZ_PER_LUONG, premium } from "./gold-math.ts";

/**
 * Regression pins for the gold premium.
 *
 * The shipped bug divided by OZ_PER_LUONG instead of multiplying, which reported
 * world parity ~31% too low and turned a realistic ~5% premium into ~53%. These
 * cases fail loudly if the direction ever flips back.
 */

test("a lượng is heavier than a troy ounce", () => {
  assert.ok(GRAMS_PER_LUONG > GRAMS_PER_TROY_OZ);
  assert.ok(OZ_PER_LUONG > 1, "OZ_PER_LUONG must exceed 1");
  assert.ok(Math.abs(OZ_PER_LUONG - 1.20565) < 1e-5);
});

test("world parity per lượng exceeds the per-ounce price in the same currency", () => {
  const { worldVndPerLuong } = premium(4445, 148_700_000, 26_300);
  // Multiplying is the only way this can hold; dividing would make it smaller.
  assert.ok(worldVndPerLuong > 4445 * 26_300);
});

test("realistic inputs produce a single-digit percent premium", () => {
  const { worldVndPerLuong, diff, pct } = premium(4445, 148_700_000, 26_300);
  assert.ok(Math.abs(worldVndPerLuong - 140_944_950) < 1_000);
  assert.ok(Math.abs(diff - 7_755_050) < 1_000);
  assert.ok(pct > 3 && pct < 12, `premium ${pct.toFixed(2)}% outside a sane band`);
});

test("a domestic price at parity yields a zero premium", () => {
  const parity = 4445 * 26_300 * OZ_PER_LUONG;
  const { diff, pct } = premium(4445, parity, 26_300);
  assert.ok(Math.abs(diff) < 1e-6);
  assert.ok(Math.abs(pct) < 1e-9);
});

test("a domestic discount reports a negative premium", () => {
  const parity = 4445 * 26_300 * OZ_PER_LUONG;
  const { pct } = premium(4445, parity * 0.9, 26_300);
  assert.ok(pct < 0);
});
