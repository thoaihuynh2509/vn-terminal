import assert from "node:assert/strict";
import test from "node:test";
import {
  stochastic, cci, williamsR, roc, obv, mfi, donchian, keltner, adx, supertrend, type OHLCV,
} from "./indicators2.ts";

const bar = (c: number, h = c + 1, l = c - 1, v = 1000): OHLCV => ({ o: c, h, l, c, v });
const rising = (n: number) => Array.from({ length: n }, (_, i) => bar(100 + i));
const wavy = (n: number) => Array.from({ length: n }, (_, i) => bar(100 + Math.sin(i / 4) * 10, 0, 0, 1000 + i)).map(
  (b) => ({ ...b, h: b.c + 2, l: b.c - 2 }));

test("every series is index-aligned with its input", () => {
  const b = wavy(80);
  const lens = [
    stochastic(b).k, stochastic(b).d, cci(b), williamsR(b), roc(b.map((x) => x.c)),
    obv(b), mfi(b), donchian(b).upper, keltner(b).upper, adx(b).adx, supertrend(b).line,
  ];
  for (const s of lens) assert.equal(s.length, b.length);
});

test("Stochastic sits near the top of its range on a rise, near the bottom on a fall", () => {
  // These bars carry a high 1 above the close, so on a rising series the close
  // can never reach the window's highest high: %K tops out at 14/15 ≈ 93.3,
  // not 100. Asserting >95 would be testing the fixture, not the indicator.
  const up = rising(40);
  const k = stochastic(up, 14).k[39]!;
  assert.ok(k > 90 && k <= 100, `expected the high end of the range, got ${k}`);

  const down = rising(40).reverse();
  const kd = stochastic(down, 14).k[39]!;
  assert.ok(kd >= 0 && kd < 10, `expected the low end of the range, got ${kd}`);

  assert.ok(k > kd + 70, "a rise and a fall must land at opposite ends");
});

test("Stochastic returns the neutral 50 on a flat range rather than dividing by zero", () => {
  const flat = Array.from({ length: 30 }, () => bar(50, 50, 50));
  assert.equal(stochastic(flat, 14).k[29], 50);
});

test("Williams %R is the Stochastic's mirror", () => {
  const b = wavy(60);
  const k = stochastic(b, 14).k[59]!;
  const r = williamsR(b, 14)[59]!;
  assert.ok(Math.abs((k - 100) - r) < 1e-6, `%R should equal %K - 100, got ${r} vs ${k}`);
});

test("CCI is zero when price sits exactly on its mean", () => {
  const flat = Array.from({ length: 40 }, () => bar(50, 50, 50));
  assert.equal(cci(flat, 20)[39], 0, "a zero mean deviation must not divide by zero");
});

test("ROC is positive while rising and undefined at zero base", () => {
  assert.ok(roc(rising(30).map((b) => b.c), 12)[29]! > 0);
  assert.equal(roc([0, 5], 1)[1], null, "a zero base has no percentage change");
});

test("OBV accumulates volume with the sign of the close", () => {
  const b = [bar(10), bar(11), bar(10), bar(12)];
  const o = obv(b);
  assert.equal(o[0], 0);
  assert.equal(o[1], 1000);   // up
  assert.equal(o[2], 0);      // down
  assert.equal(o[3], 1000);   // up
});

test("OBV is flat when the close does not move", () => {
  const b = [bar(10), bar(10), bar(10)];
  assert.deepEqual(obv(b), [0, 0, 0]);
});

test("MFI stays within 0..100", () => {
  for (const v of mfi(wavy(90), 14)) if (v !== null) assert.ok(v >= 0 && v <= 100, `out of range: ${v}`);
});

test("Donchian brackets price and its middle is the midpoint", () => {
  const b = wavy(60);
  const d = donchian(b, 20);
  const i = 59;
  assert.ok(d.upper[i]! >= b[i].h && d.lower[i]! <= b[i].l);
  assert.ok(Math.abs(d.middle[i]! - (d.upper[i]! + d.lower[i]!) / 2) < 1e-9);
});

test("Keltner bands straddle the EMA symmetrically", () => {
  const k = keltner(wavy(60), 20, 2);
  const i = 59;
  assert.ok(k.upper[i]! > k.middle[i]! && k.middle[i]! > k.lower[i]!);
  assert.ok(Math.abs((k.upper[i]! - k.middle[i]!) - (k.middle[i]! - k.lower[i]!)) < 1e-9);
});

test("ADX stays in 0..100 and DI+ leads in an uptrend", () => {
  const a = adx(rising(80), 14);
  for (const v of a.adx) if (v !== null) assert.ok(v >= 0 && v <= 100, `ADX out of range: ${v}`);
  const i = 79;
  assert.ok(a.plusDI[i]! > a.minusDI[i]!, "a pure uptrend should favour DI+");
});

test("Supertrend reports direction +1 in a sustained uptrend", () => {
  const st = supertrend(rising(80), 10, 3);
  assert.equal(st.direction[79], 1);
  assert.ok(st.line[79]! < rising(80)[79].c, "the line trails below price when long");
});

test("short inputs return all nulls rather than throwing", () => {
  const tiny = [bar(1), bar(2)];
  assert.deepEqual(adx(tiny).adx, [null, null]);
  assert.deepEqual(supertrend(tiny).line, [null, null]);
  assert.deepEqual(cci(tiny, 20), [null, null]);
});
