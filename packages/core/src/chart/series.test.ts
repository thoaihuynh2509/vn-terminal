import test from "node:test";
import assert from "node:assert/strict";
import {
  GOLD_SERIES, chartSource, dayBucket, isSeriesSymbol, seriesCode, seriesKey, seriesSymbol,
} from "./series.ts";

test("a recorded series is addressed as a chart symbol", () => {
  assert.equal(seriesSymbol("SJC"), "GOLD:SJC");
  assert.equal(seriesCode("GOLD:SJC"), "SJC");
  assert.ok(isSeriesSymbol("GOLD:SJC"));
});

test("an equity symbol is not a recorded series", () => {
  // This is how the bars route tells the two apart without a second parameter
  // that could disagree with the symbol.
  assert.equal(seriesCode("VNM"), null);
  assert.equal(isSeriesSymbol("VNM"), false);
  assert.equal(seriesCode("VNINDEX"), null);
});

test("symbols are matched case-insensitively and trimmed", () => {
  assert.equal(seriesCode("  gold:sjc "), "SJC");
});

test("a malformed series symbol is refused, not half-parsed", () => {
  for (const bad of ["GOLD:", "GOLD", "GOLD::SJC", "GOLD:S J C", "GOLD:../etc", "GOLD:" + "x".repeat(40)]) {
    assert.equal(seriesCode(bad), null, bad);
  }
});

test("every gold series we record has a usable symbol", () => {
  for (const code of GOLD_SERIES) {
    assert.equal(seriesCode(seriesSymbol(code)), code, code);
  }
});

test("the storage key is derived, not the display symbol", () => {
  assert.equal(seriesKey("sjc"), "gold:SJC");
});

test("a day bucket is midnight in exchange time", () => {
  // 2026-09-07 14:30 ICT and 2026-09-07 09:05 ICT are the same trading day.
  const at = (h: number, m: number) => Date.UTC(2026, 8, 7, h - 7, m);
  assert.equal(dayBucket(at(14, 30)), dayBucket(at(9, 5)));
});

test("two calendar days bucket apart", () => {
  const d1 = dayBucket(Date.UTC(2026, 8, 7, 5));
  const d2 = dayBucket(Date.UTC(2026, 8, 8, 5));
  assert.equal(d2 - d1, 86_400);
});

test("a bucket is a whole number of seconds at a day boundary", () => {
  const b = dayBucket(Date.UTC(2026, 8, 7, 10));
  assert.ok(Number.isInteger(b), String(b));
  assert.equal((b + 7 * 3600) % 86_400, 0, "midnight ICT");
});

test("late evening ICT still belongs to that day, not the next", () => {
  // 23:30 ICT is 16:30 UTC; a naive UTC bucket would roll it forward.
  const late = Date.UTC(2026, 8, 7, 16, 30);
  const morning = Date.UTC(2026, 8, 7, 2, 30);
  assert.equal(dayBucket(late), dayBucket(morning));
});

test("one decision point says where a symbol's bars come from", () => {
  // A separate `kind` parameter would be a second source of truth a hand-typed
  // URL could put out of step with the symbol.
  assert.deepEqual(chartSource("GOLD:SJC"), { kind: "recorded", code: "SJC" });
  assert.deepEqual(chartSource("vnm"), { kind: "equity", symbol: "VNM" });
});

test("the two namespaces cannot collide", () => {
  assert.equal(chartSource("GOLD:SJC").kind, "recorded");
  assert.equal(chartSource("GOLDMINE").kind, "equity");
});
