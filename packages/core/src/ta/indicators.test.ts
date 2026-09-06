import assert from "node:assert/strict";
import test from "node:test";
import { sma, ema, stddev, bollinger, rsi, macd, atr, vwap } from "./indicators.ts";

const close = (n: number) => Array.from({ length: n }, (_, i) => i + 1); // 1..n
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;

test("every series is index-aligned with its input", () => {
  const v = close(50);
  for (const s of [sma(v, 10), ema(v, 10), rsi(v, 14), stddev(v, 10)]) {
    assert.equal(s.length, v.length, "a shorter series would misalign the overlay");
  }
  const m = macd(v);
  assert.equal(m.macd.length, v.length);
  assert.equal(m.signal.length, v.length);
  assert.equal(m.histogram.length, v.length);
});

test("indicators are null until they are defined", () => {
  const s = sma(close(10), 5);
  assert.deepEqual(s.slice(0, 4), [null, null, null, null]);
  assert.equal(s[4], 3); // mean of 1..5
});

test("SMA matches a hand-computed window", () => {
  const s = sma([2, 4, 6, 8, 10], 3);
  assert.equal(s[2], 4);   // (2+4+6)/3
  assert.equal(s[3], 6);   // (4+6+8)/3
  assert.equal(s[4], 8);   // (6+8+10)/3
});

test("EMA seeds from the SMA and then applies the smoothing constant", () => {
  const v = [1, 2, 3, 4, 5];
  const e = ema(v, 3);
  assert.equal(e[2], 2);                       // seed = mean(1,2,3)
  const k = 2 / 4;
  assert.ok(near(e[3]!, 4 * k + 2 * (1 - k))); // 3
  assert.ok(near(e[4]!, 5 * k + 3 * (1 - k))); // 4
});

test("a constant series has zero deviation and flat bands", () => {
  const v = new Array(30).fill(100);
  assert.equal(stddev(v, 20)[29], 0);
  const b = bollinger(v, 20, 2);
  assert.equal(b.upper[29], 100);
  assert.equal(b.lower[29], 100);
  assert.equal(b.middle[29], 100);
});

test("Bollinger bands straddle the middle symmetrically", () => {
  const v = Array.from({ length: 40 }, (_, i) => 100 + Math.sin(i) * 5);
  const b = bollinger(v, 20, 2);
  const i = 39;
  assert.ok(b.upper[i]! > b.middle[i]! && b.middle[i]! > b.lower[i]!);
  assert.ok(near(b.upper[i]! - b.middle[i]!, b.middle[i]! - b.lower[i]!, 1e-9));
});

test("RSI is 100 when a series only rises and 0 when it only falls", () => {
  assert.equal(rsi(close(40), 14)[39], 100);
  const falling = close(40).map((v) => 100 - v);
  assert.ok(near(rsi(falling, 14)[39]!, 0));
});

test("RSI stays within 0..100", () => {
  const v = Array.from({ length: 200 }, (_, i) => 100 + Math.sin(i / 3) * 12 + (i % 7));
  for (const r of rsi(v, 14)) {
    if (r !== null) assert.ok(r >= 0 && r <= 100, `RSI out of range: ${r}`);
  }
});

test("MACD histogram equals macd minus signal wherever both exist", () => {
  const v = Array.from({ length: 120 }, (_, i) => 100 + Math.sin(i / 5) * 10);
  const m = macd(v);
  let checked = 0;
  m.histogram.forEach((h, i) => {
    if (h === null) return;
    assert.ok(near(h, m.macd[i]! - m.signal[i]!, 1e-9));
    checked++;
  });
  assert.ok(checked > 50, "expected a substantial defined region");
});

test("MACD of a flat series collapses to zero", () => {
  const m = macd(new Array(120).fill(50));
  assert.ok(near(m.macd[119]!, 0, 1e-9));
  assert.ok(near(m.histogram[119]!, 0, 1e-9));
});

test("ATR of constant-range bars equals that range", () => {
  const bars = Array.from({ length: 40 }, () => ({ h: 11, l: 9, c: 10 }));
  assert.ok(near(atr(bars, 14)[39]!, 2));
});

test("ATR is never negative", () => {
  const bars = Array.from({ length: 80 }, (_, i) => {
    const c = 100 + Math.sin(i / 4) * 8;
    return { h: c + 2, l: c - 3, c };
  });
  for (const a of atr(bars, 14)) if (a !== null) assert.ok(a >= 0);
});

test("VWAP sits inside the traded range and weights by volume", () => {
  const bars = [
    { h: 10, l: 10, c: 10, v: 1 },
    { h: 20, l: 20, c: 20, v: 99 },
  ];
  const w = vwap(bars)[1]!;
  assert.ok(w > 19 && w < 20, `heavy volume at 20 should dominate, got ${w}`);
});

test("VWAP with no volume yields null rather than NaN", () => {
  const bars = [{ h: 10, l: 9, c: 9.5, v: 0 }];
  assert.equal(vwap(bars)[0], null);
});

test("too-short inputs return all nulls instead of throwing", () => {
  assert.deepEqual(sma([1, 2], 20), [null, null]);
  assert.deepEqual(ema([1, 2], 20), [null, null]);
  assert.deepEqual(rsi([1, 2], 14), [null, null]);
  assert.deepEqual(atr([{ h: 1, l: 0, c: 1 }], 14), [null]);
});
