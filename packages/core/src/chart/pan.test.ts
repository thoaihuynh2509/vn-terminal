import assert from "node:assert/strict";
import test from "node:test";
import { clampOffset, maxOffset, offsetFromDrag, windowOf } from "./pan.ts";

const bars = Array.from({ length: 100 }, (_, i) => i);

test("offset zero shows the newest bars", () => {
  const w = windowOf(bars, 20, 0);
  assert.equal(w.length, 20);
  assert.equal(w[w.length - 1], 99, "the last loaded bar must stay on the right edge");
});

test("panning back reveals older bars and keeps the window size", () => {
  const w = windowOf(bars, 20, 10);
  assert.equal(w.length, 20);
  assert.equal(w[0], 70);
  assert.equal(w[w.length - 1], 89);
});

test("the window cannot pan past the oldest loaded bar", () => {
  const w = windowOf(bars, 20, 999);
  assert.equal(w[0], 0, "clamped to the start of history");
  assert.equal(w.length, 20, "and it must not shrink at the edge");
});

test("a window larger than the history is the whole history", () => {
  assert.equal(windowOf(bars, 500, 0).length, 100);
  assert.equal(windowOf(bars, 0, 0).length, 100, "range 0 means everything");
});

test("maxOffset leaves a full window visible", () => {
  assert.equal(maxOffset(100, 20), 80);
  assert.equal(maxOffset(20, 20), 0, "nothing to pan when the window is the history");
  assert.equal(maxOffset(10, 20), 0, "never negative");
});

test("dragging right walks into the past", () => {
  // 60px at a 6px band is ten bars.
  assert.equal(offsetFromDrag(0, 60, 6, 100, 20), 10);
});

test("dragging left walks back toward the present and stops there", () => {
  assert.equal(offsetFromDrag(10, -60, 6, 100, 20), 0);
  assert.equal(offsetFromDrag(0, -600, 6, 100, 20), 0, "cannot pan into the future");
});

test("a drag shorter than one bar does not move the window", () => {
  assert.equal(offsetFromDrag(0, 2, 6, 100, 20), 0);
});

test("a degenerate band cannot produce an infinite offset", () => {
  const o = offsetFromDrag(0, 60, 0, 100, 20);
  assert.ok(Number.isFinite(o) && o <= 80, `expected a clamped number, got ${o}`);
});

test("clamping rejects nonsense rather than propagating it", () => {
  assert.equal(clampOffset(NaN, 100, 20), 0);
  assert.equal(clampOffset(-5, 100, 20), 0);
  assert.equal(clampOffset(12.4, 100, 20), 12, "offsets are whole bars");
});

import { MIN_RANGE, zoomAt } from "./pan.ts";

/** Absolute index of the bar sitting under `fraction` of the plot. */
const barUnder = (total: number, range: number, offset: number, f: number) =>
  total - range - offset + f * range;

test("zooming in shows fewer bars and zooming out shows more", () => {
  assert.ok(zoomAt({ total: 500, range: 120, offset: 0, fraction: 0.5, direction: -1 }).range < 120);
  assert.ok(zoomAt({ total: 500, range: 120, offset: 0, fraction: 0.5, direction: 1 }).range > 120);
});

test("the bar under the cursor stays under the cursor", () => {
  for (const f of [0, 0.25, 0.5, 0.75, 1]) {
    for (const dir of [1, -1] as const) {
      const before = barUnder(500, 120, 60, f);
      const z = zoomAt({ total: 500, range: 120, offset: 60, fraction: f, direction: dir });
      const after = barUnder(500, z.range, z.offset, f);
      assert.ok(Math.abs(before - after) <= 1,
        `f=${f} dir=${dir}: bar ${before.toFixed(1)} moved to ${after.toFixed(1)}`);
    }
  }
});

test("zooming out stops at the loaded history", () => {
  let z = { range: 400, offset: 0 };
  for (let i = 0; i < 20; i++) z = zoomAt({ total: 500, ...z, fraction: 0.5, direction: 1 });
  assert.equal(z.range, 500, "cannot show more bars than exist");
  assert.equal(z.offset, 0, "and the window must sit flush against the end");
});

test("zooming in stops before the chart becomes unreadable", () => {
  let z = { range: 400, offset: 0 };
  for (let i = 0; i < 40; i++) z = zoomAt({ total: 500, ...z, fraction: 0.5, direction: -1 });
  assert.equal(z.range, MIN_RANGE);
});

test("zooming at the right edge keeps the latest bar visible", () => {
  const z = zoomAt({ total: 500, range: 120, offset: 0, fraction: 1, direction: -1 });
  assert.equal(z.offset, 0, "the newest bar must not be pushed off the edge");
});

test("zooming while showing everything resolves the range first", () => {
  const z = zoomAt({ total: 300, range: 0, offset: 0, fraction: 0.5, direction: -1 });
  assert.ok(z.range > 0 && z.range < 300, `expected a concrete range, got ${z.range}`);
});

test("a nonsense fraction is treated as the centre rather than propagated", () => {
  const z = zoomAt({ total: 500, range: 120, offset: 0, fraction: NaN, direction: -1 });
  assert.ok(Number.isFinite(z.range) && Number.isFinite(z.offset));
  assert.ok(z.offset >= 0);
});

test("zoom never produces a window outside the loaded history", () => {
  let z = { range: 120, offset: 0 };
  for (let i = 0; i < 60; i++) {
    z = zoomAt({ total: 500, ...z, fraction: (i % 5) / 4, direction: i % 3 === 0 ? 1 : -1 });
    assert.ok(z.range >= MIN_RANGE && z.range <= 500, `range ${z.range}`);
    assert.ok(z.offset >= 0 && z.offset <= 500 - z.range, `offset ${z.offset} with range ${z.range}`);
  }
});

import { nearestIndex, windowBounds } from "./pan.ts";

test("bounds and slice always agree", () => {
  for (const range of [0, 20, 60, 120, 500]) {
    for (const offset of [0, 5, 37, 400]) {
      const [a, b] = windowBounds(bars.length, range, offset);
      assert.deepEqual(bars.slice(a, b), windowOf(bars, range, offset), `range=${range} offset=${offset}`);
    }
  }
});

test("nearestIndex finds the closest bar, not merely a near one", () => {
  const t = [0, 10, 20, 30, 40].map((v) => ({ t: v }));
  assert.equal(nearestIndex(t, 0), 0);
  assert.equal(nearestIndex(t, 9), 1, "9 is nearer 10 than 0");
  assert.equal(nearestIndex(t, 11), 1);
  assert.equal(nearestIndex(t, 40), 4);
  assert.equal(nearestIndex(t, 999), 4, "past the end clamps to the last bar");
  assert.equal(nearestIndex(t, -999), 0);
  assert.equal(nearestIndex([], 5), 0, "an empty series has no bar to find");
});

test("nearestIndex agrees with a linear scan on every timestamp", () => {
  const t = Array.from({ length: 200 }, (_, i) => ({ t: i * 7 }));
  const scan = (target: number) => {
    let best = 0;
    for (let i = 1; i < t.length; i++) {
      if (Math.abs(t[i].t - target) < Math.abs(t[best].t - target)) best = i;
    }
    return best;
  };
  for (let target = -20; target < 1420; target += 3) {
    assert.equal(nearestIndex(t, target), scan(target), `target ${target}`);
  }
});
