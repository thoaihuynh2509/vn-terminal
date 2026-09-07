import assert from "node:assert/strict";
import test from "node:test";
import { candlePaths, decimate, maxColumnsFor, seriesPath, signedBarPaths, volumePaths, MIN_COLUMN_PX } from "./paths.ts";
import type { Bar } from "@/lib/types";

const bar = (o: number, h: number, l: number, c: number, v = 10, t = 0): Bar => ({ t, o, h, l, c, v });
const geom = { x: (i: number) => i * 10, y: (val: number) => 100 - val, bodyWidth: 6 };
const subpaths = (d: string) => (d.match(/M/g) || []).length;

test("rising and falling bars go to their own paths", () => {
  const p = candlePaths([bar(10, 12, 9, 11), bar(11, 12, 8, 9)], geom);
  assert.equal(subpaths(p.upWick), 1);
  assert.equal(subpaths(p.downWick), 1);
  assert.equal(subpaths(p.upBody), 1);
  assert.equal(subpaths(p.downBody), 1);
});

test("a bar closing exactly at its open counts as rising, matching the hollow encoding", () => {
  const p = candlePaths([bar(10, 11, 9, 10)], geom);
  assert.equal(subpaths(p.upBody), 1);
  assert.equal(subpaths(p.downBody), 0);
});

test("every bar is drawn exactly once", () => {
  const bars = Array.from({ length: 120 }, (_, i) => bar(10 + (i % 5), 16, 5, 10 + ((i + 2) % 5), 10, i));
  const p = candlePaths(bars, geom);
  assert.equal(subpaths(p.upWick) + subpaths(p.downWick), 120);
  assert.equal(subpaths(p.upBody) + subpaths(p.downBody), 120);
});

test("a doji still has a visible body", () => {
  // Open equals close, so the body has zero height and would disappear.
  // Placed away from the origin so the coordinates carry no sign to trip on.
  const p = candlePaths([bar(10, 12, 8, 10)], { ...geom, x: () => 50 });
  const top = p.upBody.match(/M[-0-9.]+,([-0-9.]+)/);
  const bottom = p.upBody.match(/V([-0-9.]+)/);
  assert.ok(top && bottom, `expected a rectangle, got ${p.upBody}`);
  const height = Number(bottom[1]) - Number(top[1]);
  assert.ok(height >= 1, `body height ${height} must be at least 1`);
});

test("bodies are centred on the bar and one body wide", () => {
  const p = candlePaths([bar(10, 12, 9, 11)], { ...geom, x: () => 50, bodyWidth: 8 });
  assert.ok(p.upBody.startsWith("M46.0,"), `body should start at 46, got ${p.upBody.slice(0, 12)}`);
  assert.ok(/H54\.0/.test(p.upBody), "body should end at 54");
});

test("an empty series draws nothing rather than a stray path", () => {
  const p = candlePaths([], geom);
  assert.deepEqual(p, { upWick: "", downWick: "", upBody: "", downBody: "" });
});

test("volume bars are split by direction and sit on the baseline", () => {
  const g = { x: (i: number) => i * 10, barWidth: 6, height: 50, maxVolume: 100 };
  const p = volumePaths([bar(10, 12, 9, 11, 100), bar(11, 12, 8, 9, 50)], g);
  assert.equal(subpaths(p.up), 1);
  assert.equal(subpaths(p.down), 1);
  assert.ok(/V50\.0/.test(p.up), "bars must reach the baseline");
});

test("a zero-volume bar still renders a sliver rather than nothing", () => {
  const g = { x: () => 10, barWidth: 6, height: 50, maxVolume: 100 };
  const p = volumePaths([bar(10, 12, 9, 11, 0)], g);
  assert.equal(subpaths(p.up), 1);
});

test("a series with no volume at all does not divide by zero", () => {
  const g = { x: () => 10, barWidth: 6, height: 50, maxVolume: 0 };
  const p = volumePaths([bar(10, 12, 9, 11, 0)], g);
  assert.ok(!/NaN/.test(p.up + p.down), `produced NaN: ${p.up}`);
});

// ── P2-9: decimation ────────────────────────────────────────────────

/** Positional helper for the decimation tests: index first, then OHLCV. */
const at = (i: number, o: number, h: number, l: number, c: number, v = 100): Bar =>
  ({ t: i * 60, o, h, l, c, v });

test("a window that fits is returned bar for bar", () => {
  const bars = [at(0, 1, 2, 0.5, 1.5), at(1, 1.5, 3, 1, 2)];
  const out = decimate(bars, 10);
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((b) => b.span), [1, 1]);
  assert.deepEqual(out.map((b) => b.i), [0, 1]);
});

test("folding never exceeds the column cap", () => {
  const bars = Array.from({ length: 1000 }, (_, i) => at(i, 1, 2, 0.5, 1.5));
  for (const cap of [1, 7, 100, 333, 999]) {
    assert.ok(decimate(bars, cap).length <= cap, `cap ${cap}`);
  }
});

test("a folded column is a real OHLC bar for its span", () => {
  // open of the first, close of the last, true high, true low, volume summed.
  const bars = [
    at(0, 10, 12, 9, 11, 5),
    at(1, 11, 15, 8, 13, 7),
    at(2, 13, 14, 10, 12, 9),
  ];
  const [b] = decimate(bars, 1);
  assert.equal(b.bar.o, 10);
  assert.equal(b.bar.c, 12);
  assert.equal(b.bar.h, 15);
  assert.equal(b.bar.l, 8);
  assert.equal(b.bar.v, 21);
  assert.equal(b.span, 3);
});

test("an extreme is never lost, however hard the window is folded", () => {
  // The whole point: a spike must survive zooming out. Sampling every Nth bar
  // would delete exactly the bar a trader is looking for.
  const bars = Array.from({ length: 500 }, (_, i) => at(i, 10, 10.5, 9.5, 10));
  bars[377] = at(377, 10, 99, 1, 10);
  for (const cap of [2, 13, 64, 250]) {
    const cols = decimate(bars, cap);
    assert.equal(Math.max(...cols.map((c) => c.bar.h)), 99, `cap ${cap} lost the high`);
    assert.equal(Math.min(...cols.map((c) => c.bar.l)), 1, `cap ${cap} lost the low`);
  }
});

test("the first open and the last close survive folding", () => {
  const bars = Array.from({ length: 97 }, (_, i) => at(i, i, i + 1, i - 1, i + 0.5));
  const cols = decimate(bars, 8);
  assert.equal(cols[0].bar.o, bars[0].o);
  assert.equal(cols[cols.length - 1].bar.c, bars[96].c);
});

test("total volume is conserved", () => {
  const bars = Array.from({ length: 250 }, (_, i) => at(i, 1, 2, 0.5, 1.5, i));
  const total = bars.reduce((s, b) => s + b.v, 0);
  assert.equal(decimate(bars, 17).reduce((s, c) => s + c.bar.v, 0), total);
});

test("columns are drawn in order and stay inside the index range", () => {
  const bars = Array.from({ length: 333 }, (_, i) => at(i, 1, 2, 0.5, 1.5));
  const cols = decimate(bars, 40);
  for (let k = 1; k < cols.length; k++) assert.ok(cols[k].i > cols[k - 1].i);
  assert.ok(cols[0].i >= 0);
  assert.ok(cols[cols.length - 1].i <= bars.length - 1);
});

test("every bar is accounted for exactly once", () => {
  const bars = Array.from({ length: 101 }, (_, i) => at(i, 1, 2, 0.5, 1.5));
  assert.equal(decimate(bars, 10).reduce((s, c) => s + c.span, 0), 101);
});

test("decimate is safe on empty and degenerate caps", () => {
  assert.deepEqual(decimate([], 10), []);
  assert.equal(decimate([at(0, 1, 2, 0.5, 1.5)], 0).length, 1);
});

test("a dense candle window collapses the path payload", () => {
  const bars = Array.from({ length: 2000 }, (_, i) => at(i, 10, 11, 9, 10.5));
  const g = { x: (i: number) => i * 0.6, y: (v: number) => 400 - v, bodyWidth: 1 };
  const full = candlePaths(bars, g);
  const thin = candlePaths(bars, g, maxColumnsFor(1200));
  const size = (p: { upWick: string; downWick: string; upBody: string; downBody: string }) =>
    p.upWick.length + p.downWick.length + p.upBody.length + p.downBody.length;
  assert.ok(size(thin) < size(full) * 0.55, `${size(thin)} vs ${size(full)}`);
});

test("candles below the cap are byte-identical to the undecimated path", () => {
  // Decimation must be invisible at normal densities, not merely close.
  const bars = Array.from({ length: 120 }, (_, i) => at(i, 10 + i * 0.01, 11, 9, 10.5));
  const g = { x: (i: number) => i * 6, y: (v: number) => 400 - v, bodyWidth: 4 };
  assert.deepEqual(candlePaths(bars, g, 500), candlePaths(bars, g));
});

test("a plot resolves as many columns as it has pixel slots", () => {
  assert.equal(maxColumnsFor(1200), Math.floor(1200 / MIN_COLUMN_PX));
  assert.equal(maxColumnsFor(0), 1);
});

test("volume folds to the mean, so a wide column does not tower", () => {
  // Summing would make one folded column dwarf every unfolded neighbour.
  const bars = Array.from({ length: 4 }, (_, i) => at(i, 1, 2, 0.5, 1.5, 100));
  const g = { x: (i: number) => i, barWidth: 1, height: 100, maxVolume: 100 };
  const folded = volumePaths(bars, g, 1);
  const single = volumePaths([at(0, 1, 2, 0.5, 1.5, 100)], g);
  // Same mean volume → same bar height, whatever the span.
  const topOf = (d: string) => d.match(/M[\d.]+,([\d.]+)/)?.[1];
  assert.equal(topOf(folded.up), topOf(single.up));
});

test("a null breaks the line instead of bridging the gap", () => {
  // The old map/filter/join drew a straight segment across missing days.
  const d = seriesPath([1, 2, null, 4, 5], (i) => i * 10, (v) => v);
  assert.equal(d.match(/M/g)?.length, 2, d);
});

test("leading nulls do not start the line early", () => {
  const d = seriesPath([null, null, 3, 4], (i) => i * 10, (v) => v);
  assert.ok(d.startsWith("M20.0"), d);
});

test("an all-null series draws nothing", () => {
  assert.equal(seriesPath([null, null], (i) => i, (v) => v), "");
  assert.equal(seriesPath([], (i) => i, (v) => v), "");
});

test("a decimated line keeps its spikes", () => {
  const vals = Array.from({ length: 600 }, () => 50);
  vals[123] = 5;
  vals[456] = 95;
  const d = seriesPath(vals, (i) => i, (v) => v, 40);
  // y is identity here, so the extremes appear literally in the path data.
  assert.ok(d.includes(",5.0"), "lost the trough");
  assert.ok(d.includes(",95.0"), "lost the peak");
});

test("a decimated line never doubles back within a bucket", () => {
  // Points must be emitted in the order they occurred, not min-then-max.
  const vals = Array.from({ length: 100 }, (_, i) => (i === 10 ? 99 : i === 90 ? 1 : 50));
  const d = seriesPath(vals, (i) => i, (v) => v, 4);
  const xs = [...d.matchAll(/[ML]([\d.]+),/g)].map((m) => Number(m[1]));
  for (let i = 1; i < xs.length; i++) assert.ok(xs[i] >= xs[i - 1], `${xs[i-1]} -> ${xs[i]}`);
});

test("a bucket with no data at all lifts the pen", () => {
  const vals: (number | null)[] = Array.from({ length: 100 }, () => null);
  for (let i = 0; i < 25; i++) vals[i] = 10;
  for (let i = 75; i < 100; i++) vals[i] = 20;
  const d = seriesPath(vals, (i) => i, (v) => v, 10);
  assert.equal(d.match(/M/g)?.length, 2, d);
});

test("a sparse line below the cap is unchanged by a cap", () => {
  const vals = [1, null, 3, 4, null, 6];
  assert.equal(
    seriesPath(vals, (i) => i, (v) => v, 100),
    seriesPath(vals, (i) => i, (v) => v),
  );
});

test("NaN is treated as a hole, not plotted", () => {
  const d = seriesPath([1, NaN, 3], (i) => i, (v) => v);
  assert.ok(!d.includes("NaN"), d);
  assert.equal(d.match(/M/g)?.length, 2, d);
});

const sbGeom = { x: (i: number) => i * 10, y: (v: number) => 50 - v, zeroY: 50, barWidth: 4 };

test("signed bars split by sign so each keeps its own fill", () => {
  const p = signedBarPaths([5, -5, 3], sbGeom);
  assert.equal(subpaths(p.up), 2);
  assert.equal(subpaths(p.down), 1);
});

test("a zero or missing value draws no bar at all", () => {
  const p = signedBarPaths([0, null, NaN], sbGeom);
  assert.equal(p.up, "");
  assert.equal(p.down, "");
});

test("a positive bar sits above the baseline and a negative below", () => {
  const up = signedBarPaths([10], sbGeom).up;
  const down = signedBarPaths([-10], sbGeom).down;
  // y(10) = 40 (above the 50 baseline), y(-10) = 60 (below it).
  assert.ok(up.includes("40.0"), up);
  assert.ok(down.includes("60.0"), down);
});

test("a bar too short to see is still drawn", () => {
  // A near-zero histogram value is activity; it must not silently vanish.
  const p = signedBarPaths([0.0001], sbGeom);
  assert.notEqual(p.up, "");
});

test("signed bars fold to the bucket mean, not the sum", () => {
  // Summing would make a folded column tower over its unfolded neighbours, so
  // the bar's HEIGHT must not depend on how many bars folded into it.
  const vExtent = (d: string) => {
    const m = [...d.matchAll(/[,V]([\d.]+)/g)].map((x) => Number(x[1]));
    return [Math.min(...m), Math.max(...m)];
  };
  assert.deepEqual(
    vExtent(signedBarPaths([10, 10, 10, 10], sbGeom, 1).up),
    vExtent(signedBarPaths([10], sbGeom).up),
  );
  // And a bucket averaging to half the value is drawn half as tall.
  const [top] = vExtent(signedBarPaths([10, 0, 10, 0], sbGeom, 1).up);
  assert.equal(top, 45);
});

test("folding respects the column cap", () => {
  const vals = Array.from({ length: 900 }, (_, i) => (i % 2 ? 1 : -1));
  const p = signedBarPaths(vals, sbGeom, 30);
  assert.ok(subpaths(p.up) + subpaths(p.down) <= 30);
});

test("a dense signed-bar pane collapses its payload", () => {
  const vals = Array.from({ length: 2000 }, (_, i) => Math.sin(i) * 10);
  const full = signedBarPaths(vals, sbGeom);
  const thin = signedBarPaths(vals, sbGeom, maxColumnsFor(1200));
  assert.ok(thin.up.length + thin.down.length < (full.up.length + full.down.length) * 0.55);
});

test("signed bars below the cap are identical to the undecimated form", () => {
  const vals = [3, -2, 0, 5, null, -7];
  assert.deepEqual(signedBarPaths(vals, sbGeom, 500), signedBarPaths(vals, sbGeom));
});

test("signed bars are safe on an empty series", () => {
  assert.deepEqual(signedBarPaths([], sbGeom), { up: "", down: "" });
});
