import test from "node:test";
import assert from "node:assert/strict";
import { COMPARE_LIMIT, dashFor, encodeCompare, parseCompare } from "./compare.ts";

test("comparing is a paid capability", () => {
  assert.deepEqual(parseCompare("VNINDEX", "anon", "VNM"), []);
  assert.deepEqual(parseCompare("VNINDEX", "free", "VNM"), []);
  assert.equal(COMPARE_LIMIT.plus, 1);
  assert.equal(COMPARE_LIMIT.pro, 3);
});

test("the legacy cmp=1 link still means VNINDEX", () => {
  // Every link shared before this existed says cmp=1; breaking them would be a
  // self-inflicted regression on the feature we are widening.
  assert.deepEqual(parseCompare("1", "plus", "VNM"), ["VNINDEX"]);
  assert.deepEqual(parseCompare("1", "pro", "VNM"), ["VNINDEX"]);
});

test("an arbitrary symbol can be overlaid", () => {
  assert.deepEqual(parseCompare("hpg", "plus", "VNM"), ["HPG"]);
});

test("the tier caps how many overlays are shown", () => {
  assert.deepEqual(parseCompare("VNINDEX,HPG,FPT", "plus", "VNM"), ["VNINDEX"]);
  assert.deepEqual(parseCompare("VNINDEX,HPG,FPT,SSI", "pro", "VNM"), ["VNINDEX", "HPG", "FPT"]);
});

test("a stock is never overlaid on itself", () => {
  // It would draw a flat line at 100% and read as a broken chart.
  assert.deepEqual(parseCompare("VNM,HPG", "pro", "VNM"), ["HPG"]);
  assert.deepEqual(parseCompare("vnm", "pro", "VNM"), []);
});

test("duplicates and junk are dropped", () => {
  assert.deepEqual(parseCompare("HPG,HPG,,  ,../x,<script>,FPT", "pro", "VNM"), ["HPG", "FPT"]);
});

test("nothing to compare encodes to nothing, not an empty parameter", () => {
  assert.equal(encodeCompare([]), null);
  assert.equal(encodeCompare(["HPG", "FPT"]), "HPG,FPT");
});

test("overlays are distinguishable without colour", () => {
  // The same rule the candles follow: direction and identity never by hue alone.
  assert.notEqual(dashFor(0), dashFor(1));
  assert.notEqual(dashFor(1), dashFor(2));
  assert.equal(dashFor(3), dashFor(0), "a fourth series cycles rather than going solid");
});
