import assert from "node:assert/strict";
import test from "node:test";
import { StringSink, columnsFor, emitCandles, emitSeries, emitSignedBars, emitVolume } from "./geometry.ts";
import { candlePaths, seriesPath, signedBarPaths, volumePaths } from "./paths.ts";
import type { Bar } from "@/lib/types";

/**
 * The contract that lets `paths.ts` delegate here: through a string sink, the
 * shared geometry reproduces today's path data byte for byte, across dense and
 * sparse windows, holes and NaN — so moving the folding changes no chart.
 */
function rng(seed: number) {
  return () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
}
function barsOf(n: number, seed: number): Bar[] {
  const r = rng(seed); let p = 60;
  return Array.from({ length: n }, (_, i) => {
    p += r() - 0.5; const o = p, c = p + r() - 0.5;
    return { t: i * 86400, o, h: Math.max(o, c) + r(), l: Math.min(o, c) - r(), c, v: Math.floor(r() * 1e6) };
  });
}
function seriesOf(n: number, seed: number): (number | null)[] {
  const r = rng(seed);
  return Array.from({ length: n }, () => { const q = r(); return q < 0.05 ? null : q < 0.07 ? NaN : q * 100 - 50; });
}
const x = (i: number) => 6 + i * 3.7;
const y = (v: number) => 400 - v * 2.3;
const CAPS = [undefined, 7, 50, 333, 5000];
const SIZES = [0, 1, 13, 120, 3057];

test("candles through the string sink are byte-identical to candlePaths", () => {
  for (const n of SIZES) for (const cap of CAPS) {
    const bars = barsOf(n, n + 1);
    const g = { x, y, bodyWidth: 2.3 };
    const s = { upWick: new StringSink(), downWick: new StringSink(), upBody: new StringSink(), downBody: new StringSink() };
    emitCandles(bars, g, cap, s);
    assert.deepEqual(
      { upWick: s.upWick.d, downWick: s.downWick.d, upBody: s.upBody.d, downBody: s.downBody.d },
      candlePaths(bars, g, cap), `n=${n} cap=${cap}`);
  }
});

test("volume through the string sink is byte-identical to volumePaths", () => {
  for (const n of SIZES) for (const cap of CAPS) {
    const bars = barsOf(n, n + 7);
    const g = { x, barWidth: 2.1, height: 56, maxVolume: 1e6 };
    const s = { up: new StringSink(), down: new StringSink() };
    emitVolume(bars, g, cap, s);
    assert.deepEqual({ up: s.up.d, down: s.down.d }, volumePaths(bars, g, cap), `n=${n} cap=${cap}`);
  }
});

test("a series through the string sink is byte-identical to seriesPath", () => {
  for (const n of SIZES) for (const cap of CAPS) {
    const vals = seriesOf(n, n + 3);
    const s = new StringSink();
    emitSeries(vals, x, y, cap, s);
    assert.equal(s.d, seriesPath(vals, x, y, cap), `n=${n} cap=${cap}`);
  }
});

test("signed bars through the string sink are byte-identical to signedBarPaths", () => {
  for (const n of SIZES) for (const cap of CAPS) {
    const vals = seriesOf(n, n + 11);
    const g = { x, y, zeroY: 200, barWidth: 2.4 };
    const s = { up: new StringSink(), down: new StringSink() };
    emitSignedBars(vals, g, cap, s);
    assert.deepEqual({ up: s.up.d, down: s.down.d }, signedBarPaths(vals, g, cap), `n=${n} cap=${cap}`);
  }
});

test("the column count is what was drawn, folded or not", () => {
  const bars = barsOf(3057, 5);
  const s = { upWick: new StringSink(), downWick: new StringSink(), upBody: new StringSink(), downBody: new StringSink() };
  assert.equal(emitCandles(bars.slice(0, 40), { x, y, bodyWidth: 2 }, 100, s), 40);
  assert.ok(emitCandles(bars, { x, y, bodyWidth: 2 }, 100, s) <= 100);
});

test("columnsFor predicts exactly what emitCandles draws", () => {
  for (const n of SIZES) for (const cap of CAPS) {
    const s = { upWick: new StringSink(), downWick: new StringSink(), upBody: new StringSink(), downBody: new StringSink() };
    assert.equal(columnsFor(n, cap), emitCandles(barsOf(n, 1), { x, y, bodyWidth: 2 }, cap, s), `n=${n} cap=${cap}`);
  }
});
