import assert from "node:assert/strict";
import test from "node:test";
import {
  MIN_RANGE, clampHover, clampOffset, maxOffset, nearestIndex, offsetFromDrag, pinch, spreadOf,
  windowBounds, windowOf, zoomAt,
} from "./pan.ts";

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

// ── P2-15: pinch ────────────────────────────────────────────────────
const P = (x: number, y = 0) => ({ x, y });

test("spread is the distance between two fingers", () => {
  assert.equal(spreadOf(P(0, 0), P(3, 4)), 5);
  assert.equal(spreadOf(P(10), P(10)), 0);
});

test("fingers moving apart zooms IN — fewer bars, each wider", () => {
  const out = pinch({
    total: 1000, startRange: 200, startOffset: 0,
    startSpread: 100, spread: 200, fraction: 0.5,
  });
  assert.equal(out.range, 100);
});

test("fingers coming together zooms OUT", () => {
  const out = pinch({
    total: 1000, startRange: 200, startOffset: 0,
    startSpread: 200, spread: 100, fraction: 0.5,
  });
  assert.equal(out.range, 400);
});

test("an unchanged spread changes nothing", () => {
  const args = {
    total: 1000, startRange: 200, startOffset: 30,
    startSpread: 150, spread: 150, fraction: 0.3,
  };
  assert.deepEqual(pinch(args), { range: 200, offset: 30 });
});

test("pinching out and back returns to the range it began with", () => {
  // The reason the scale is measured from the START of the gesture: accumulating
  // per-frame ratios rounds to whole bars each time, and the error compounds
  // until a pinch does not undo itself.
  const start = { total: 1000, startRange: 240, startOffset: 50, startSpread: 120, fraction: 0.5 };
  let last = { range: start.startRange, offset: start.startOffset };
  for (const spread of [130, 160, 200, 260, 200, 160, 130, 120]) {
    last = pinch({ ...start, spread });
  }
  assert.deepEqual(last, { range: 240, offset: 50 });
});

test("the bar under the fingers stays under the fingers", () => {
  // Same anchoring contract the wheel has: pinch about the left edge must not
  // slide the leftmost bar away.
  const total = 1000, startRange = 200, startOffset = 0;
  const before = windowBounds(total, startRange, startOffset);
  const after = pinch({ total, startRange, startOffset, startSpread: 100, spread: 200, fraction: 0 });
  const bounds = windowBounds(total, after.range, after.offset);
  assert.equal(bounds[0], before[0]);
});

test("pinch and wheel anchor identically", () => {
  // Both go through rangeAt, so a chart cannot feel different depending on
  // which device the reader used.
  const base = { total: 1000, range: 200, offset: 40, fraction: 0.25 };
  const wheel = zoomAt({ ...base, direction: -1 });
  const byPinch = pinch({
    total: base.total, startRange: base.range, startOffset: base.offset,
    startSpread: 100, spread: 120, fraction: base.fraction,
  });
  assert.deepEqual(byPinch, wheel);
});

test("pinch respects the floor and the ceiling on range", () => {
  const huge = pinch({
    total: 500, startRange: 200, startOffset: 0, startSpread: 1, spread: 1000, fraction: 0.5,
  });
  assert.equal(huge.range, MIN_RANGE);
  const tiny = pinch({
    total: 500, startRange: 200, startOffset: 0, startSpread: 1000, spread: 1, fraction: 0.5,
  });
  assert.equal(tiny.range, 500);
});

test("a gesture with no starting spread does nothing rather than dividing by zero", () => {
  const out = pinch({
    total: 1000, startRange: 200, startOffset: 10, startSpread: 0, spread: 50, fraction: 0.5,
  });
  assert.deepEqual(out, { range: 200, offset: 10 });
  const gone = pinch({
    total: 1000, startRange: 200, startOffset: 10, startSpread: 50, spread: 0, fraction: 0.5,
  });
  assert.deepEqual(gone, { range: 200, offset: 10 });
});

test("pinching from 'everything loaded' starts from the real bar count", () => {
  const out = pinch({
    total: 300, startRange: 0, startOffset: 0, startSpread: 100, spread: 200, fraction: 0.5,
  });
  assert.equal(out.range, 150);
});

test("the window never runs off the loaded history", () => {
  for (const spread of [1, 40, 99, 250, 4000]) {
    const out = pinch({
      total: 400, startRange: 100, startOffset: 300, startSpread: 100, spread, fraction: 0.9,
    });
    assert.ok(out.offset >= 0 && out.offset <= maxOffset(400, out.range), `spread ${spread}`);
    const [a, b] = windowBounds(400, out.range, out.offset);
    assert.ok(a >= 0 && b <= 400 && a < b, `bounds ${a}..${b}`);
  }
});

/**
 * Zooming re-slices the window but leaves the hovered index alone, so an index
 * picked in a wide window can outlive the window that made it valid. The chart
 * then reads `view[idx - 1].c` for a bar that is no longer there and throws
 * "Cannot read properties of undefined (reading 'c')" — a crash on an ordinary
 * zoom, reported from production.
 */
test("a hover picked in a wide window survives a zoom without going out of bounds", () => {
  // Hovering bar 200 of 300, then zooming in to a 60-bar window.
  assert.equal(clampHover(200, 60), 59);
  // The read that actually threw was one bar BEHIND the hover.
  const idx = clampHover(200, 60)!;
  assert.ok(idx - 1 < 60 && idx - 1 >= 0, "idx - 1 must also be addressable");
});

test("clampHover keeps a valid index untouched", () => {
  assert.equal(clampHover(0, 60), 0);
  assert.equal(clampHover(30, 60), 30);
  assert.equal(clampHover(59, 60), 59);
});

test("no hover, or nothing to hover, is null rather than an index", () => {
  assert.equal(clampHover(null, 60), null);
  assert.equal(clampHover(5, 0), null, "an empty window has no hoverable bar");
  assert.equal(clampHover(0, 0), null);
});

test("a nonsense hover never becomes an index", () => {
  assert.equal(clampHover(Number.NaN, 60), null);
  assert.equal(clampHover(Number.POSITIVE_INFINITY, 60), null);
  assert.equal(clampHover(-4, 60), 0, "a negative index clamps to the first bar");
  assert.equal(clampHover(12.7, 60), 12, "a fractional index floors onto a real bar");
});
