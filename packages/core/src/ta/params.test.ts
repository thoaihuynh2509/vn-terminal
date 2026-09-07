import test from "node:test";
import assert from "node:assert/strict";
import {
  clampPeriod, effectivePeriod, formatRef, labelFor, parseRef, sameIndicator, shortFor,
} from "./params.ts";
import { getIndicator, INDICATORS, type IndicatorDef } from "./registry.ts";

const rsi = getIndicator("rsi")!;
const macd = getIndicator("macd")!;

test("a bare id parses as the registry default", () => {
  assert.deepEqual(parseRef("rsi"), { id: "rsi", period: null });
  assert.equal(effectivePeriod(rsi, null), 14);
});

test("a tuned token carries its period", () => {
  assert.deepEqual(parseRef("rsi:21"), { id: "rsi", period: 21 });
  assert.equal(effectivePeriod(rsi, 21), 21);
});

test("links and layouts written before periods existed still parse", () => {
  // The compatibility promise: no migration, nobody loses a chart.
  for (const def of INDICATORS) assert.ok(parseRef(def.id), def.id);
});

test("a malformed token is refused outright, not half-applied", () => {
  // Applying a period nobody chose is worse than dropping the indicator.
  for (const bad of ["", ":", ":14", "rsi:", "rsi:0", "rsi:-4", "rsi:1.5", "RSI:x", "a b", "rsi:1234567", "1rsi"]) {
    assert.equal(parseRef(bad), null, bad);
  }
});

test("tokens are case-insensitive and trimmed", () => {
  assert.deepEqual(parseRef("  RSI:21 "), { id: "rsi", period: 21 });
});

test("a period equal to the default is omitted from the token", () => {
  // Two readers who never opened the settings must share identical links.
  assert.equal(formatRef({ id: "rsi", period: 14 }, rsi), "rsi");
  assert.equal(formatRef({ id: "rsi", period: 21 }, rsi), "rsi:21");
  assert.equal(formatRef({ id: "rsi", period: null }, rsi), "rsi");
});

test("an untunable indicator never grows a period", () => {
  assert.equal(macd.param, undefined);
  assert.equal(formatRef({ id: "macd", period: 9 }, macd), "macd");
  assert.equal(effectivePeriod(macd, 9), 0);
  assert.equal(clampPeriod(macd, 9), 0);
});

test("an out-of-range period is clamped, not refused", () => {
  // A hand-typed URL should give the longest average the chart supports rather
  // than a broken pane — and that has to hold at the TOKEN level too, or an
  // oversized number drops the indicator instead of clamping it.
  assert.equal(effectivePeriod(rsi, 100000), rsi.param!.max);
  assert.equal(effectivePeriod(rsi, 1), rsi.param!.min);
  const ref = parseRef("rsi:99999");
  assert.deepEqual(ref, { id: "rsi", period: 99999 });
  assert.equal(effectivePeriod(rsi, ref!.period), rsi.param!.max);
});

test("a fractional period is rounded to something computable", () => {
  assert.equal(clampPeriod(rsi, 20.6), 21);
});

test("labels show the period actually in use", () => {
  assert.equal(labelFor(rsi, null), "RSI (14)");
  assert.equal(labelFor(rsi, 21), "RSI (21)");
  assert.equal(shortFor(rsi, 21), "RSI21");
  assert.equal(labelFor(macd, null), "MACD (12, 26, 9)");
  assert.equal(shortFor(macd, null), "MACD");
});

test("a label never advertises a period the chart will not use", () => {
  // If the label said 100000 while compute clamped to 200, the chart would lie.
  assert.equal(labelFor(rsi, 100000), `RSI (${rsi.param!.max})`);
});

test("toggling matches by indicator, not by tuning", () => {
  assert.ok(sameIndicator("rsi", "rsi:21"));
  assert.ok(sameIndicator("rsi:9", "rsi:21"));
  assert.ok(!sameIndicator("rsi", "sma20"));
  assert.ok(!sameIndicator("rsi", "nonsense:"));
});

test("every tunable default sits inside its own range", () => {
  for (const d of INDICATORS) {
    if (!d.param) continue;
    assert.ok(d.param.min <= d.param.default, `${d.id} default below min`);
    assert.ok(d.param.default <= d.param.max, `${d.id} default above max`);
    assert.ok(d.param.min >= 1, `${d.id} min must be computable`);
  }
});

test("a tunable indicator's label carries no hard-coded period", () => {
  // The number a reader sees must come from the period in use, never from a
  // string welded into the catalogue — otherwise tuning it makes the label lie.
  for (const d of INDICATORS) {
    if (!d.param) continue;
    assert.ok(!/\d/.test(d.label), `${d.id} label "${d.label}" has a baked-in number`);
    assert.ok(!/\d/.test(d.short), `${d.id} short "${d.short}" has a baked-in number`);
  }
});

test("every tunable indicator actually responds to its period", () => {
  // A def could declare a param and ignore it in compute; that would be a knob
  // wired to nothing. Two different periods must give two different series.
  const bars = Array.from({ length: 300 }, (_, i) => ({
    t: i * 86400, o: 10 + Math.sin(i / 5), h: 11 + Math.sin(i / 5),
    l: 9 + Math.sin(i / 5), c: 10 + Math.sin(i / 3), v: 1000 + i,
  }));
  const flat = (d: IndicatorDef, p: number) =>
    JSON.stringify(d.compute(bars, p).map((x) => x.series));
  for (const d of INDICATORS) {
    if (!d.param) continue;
    assert.notEqual(flat(d, d.param.min), flat(d, d.param.max), `${d.id} ignores its period`);
  }
});
