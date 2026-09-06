import assert from "node:assert/strict";
import test from "node:test";
import { candlePaths, volumePaths } from "./paths.ts";
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
