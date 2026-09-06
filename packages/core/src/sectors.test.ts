import assert from "node:assert/strict";
import test from "node:test";
import { sectorOf, sectorStats, breadthDivergence, turnoverLeaders } from "./sectors.ts";
import type { Quote } from "./types.ts";

const q = (symbol: string, changePct: number, price = 10, volume = 1000): Quote => ({
  symbol, price, change: (price * changePct) / 100, changePct, volume,
});

test("known VN30 symbols map to their desk sector", () => {
  assert.equal(sectorOf("VCB"), "bank");
  assert.equal(sectorOf("VHM"), "realestate");
  assert.equal(sectorOf("GAS"), "energy");
  assert.equal(sectorOf("ZZZ"), "other", "unknown symbols must not throw");
});

test("sector change is weighted by turnover, not an equal-weight mean", () => {
  // A large, heavily traded bank up 1% and a tiny one down 10%: the equal-weight
  // mean would say the sector fell; turnover weighting says it rose.
  const board = [q("VCB", 1, 100, 1_000_000), q("TPB", -10, 10, 100)];
  const banks = sectorStats(board).find((s) => s.key === "bank")!;
  assert.ok(banks.weightedChangePct > 0, `expected positive, got ${banks.weightedChangePct}`);
  assert.equal(banks.advancing, 1);
  assert.equal(banks.declining, 1);
});

test("sectors with no turnover fall back to an equal-weight mean", () => {
  const board = [q("VCB", 2, 100, 0), q("BID", -2, 100, 0)];
  const banks = sectorStats(board).find((s) => s.key === "bank")!;
  assert.ok(Number.isFinite(banks.weightedChangePct), "must not divide by zero");
  assert.ok(Math.abs(banks.weightedChangePct) < 1e-9);
});

test("breadth divergence detects a narrow rally", () => {
  const board = [q("A", 5), q("B", -1), q("C", -1), q("D", -1)];
  assert.equal(breadthDivergence(0.4, board), "narrow-rally");
});

test("breadth divergence detects a narrow selloff", () => {
  const board = [q("A", -5), q("B", 1), q("C", 1), q("D", 1)];
  assert.equal(breadthDivergence(-0.4, board), "narrow-selloff");
});

test("agreement between index and breadth is not a divergence", () => {
  const board = [q("A", 2), q("B", 1), q("C", 1), q("D", -1)];
  assert.equal(breadthDivergence(0.8, board), "none");
});

test("turnover leaders rank by traded value, not percentage move", () => {
  const board = [q("SMALL", 9, 5, 1000), q("BIG", 0.2, 200, 1_000_000)];
  assert.equal(turnoverLeaders(board, 1)[0].symbol, "BIG");
});
