import assert from "node:assert/strict";
import test from "node:test";
import { channelOffset, channelPrices, distanceToChannel, distanceToFib, distanceToHLine, distanceToTrend, fibLevels, parseDrawings, serializeDrawings, storageKey, trendPriceAt, type Drawing, type TrendLine } from "./drawings.ts";

const trend: TrendLine = { id: "a", kind: "trend", t1: 0, p1: 10, t2: 100, p2: 20 };
// Identity normalisation keeps the arithmetic checkable by hand.
const norm = { t: (v: number) => v, p: (v: number) => v };

test("horizontal distance is a plain price difference", () => {
  assert.equal(distanceToHLine({ id: "h", kind: "hline", price: 50 }, 53), 3);
  assert.equal(distanceToHLine({ id: "h", kind: "hline", price: 50 }, 47), 3);
});

test("a point on the trendline has zero distance", () => {
  assert.ok(distanceToTrend(trend, 50, 15, norm) < 1e-9);
  assert.ok(distanceToTrend(trend, 0, 10, norm) < 1e-9);
});

test("distance is clamped to the segment, not the infinite line", () => {
  // (200, 30) lies on the infinite extension but far past the second endpoint,
  // so it must NOT register as a hit.
  assert.ok(distanceToTrend(trend, 200, 30, norm) > 50);
});

test("trendPriceAt extrapolates along the slope", () => {
  assert.equal(trendPriceAt(trend, 0), 10);
  assert.equal(trendPriceAt(trend, 100), 20);
  assert.equal(trendPriceAt(trend, 50), 15);
  assert.equal(trendPriceAt(trend, 200), 30, "extends beyond the drawn segment");
});

test("a vertical trendline does not divide by zero", () => {
  const v: TrendLine = { id: "v", kind: "trend", t1: 5, p1: 1, t2: 5, p2: 9 };
  assert.ok(Number.isFinite(trendPriceAt(v, 7)));
});

test("drawings round-trip through storage", () => {
  const items: Drawing[] = [
    { id: "1", kind: "hline", price: 62.5 },
    trend,
  ];
  assert.deepEqual(parseDrawings(serializeDrawings(items)), items);
});

test("corrupt storage yields an empty canvas rather than throwing", () => {
  for (const bad of [null, "", "not json", "{}", "[1,2,3]", '[{"id":1}]']) {
    assert.deepEqual(parseDrawings(bad as string | null), []);
  }
});

test("entries with non-finite coordinates are discarded", () => {
  const raw = JSON.stringify([
    { id: "ok", kind: "hline", price: 10 },
    { id: "bad", kind: "hline", price: null },
    { id: "bad2", kind: "trend", t1: 0, p1: 1, t2: 2 },
  ]);
  const out = parseDrawings(raw);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, "ok");
});

test("storage is keyed per symbol and case-insensitive", () => {
  assert.equal(storageKey("vnm"), storageKey("VNM"));
  assert.notEqual(storageKey("VNM"), storageKey("FPT"));
});

test("a retracement puts 0% at the end of the swing and 100% at its start", () => {
  // Drawn from a swing low of 100 up to a high of 200.
  const d = { id: "a", kind: "fib" as const, t1: 0, p1: 100, t2: 10, p2: 200 };
  const at = (r: number) => {
    const hit = fibLevels(d).find((l) => l.ratio === r);
    assert.ok(hit, `no ${r} level`);
    return hit.price;
  };
  assert.equal(at(0), 200, "0% sits at the end of the move");
  assert.equal(at(1), 100, "100% sits at its start");
  assert.equal(at(0.5), 150, "half the move");
  assert.ok(Math.abs(at(0.618) - 138.2) < 1e-9, `0.618 should be 138.2, got ${at(0.618)}`);
});

test("a retracement drawn downwards mirrors correctly", () => {
  const d = { id: "b", kind: "fib" as const, t1: 0, p1: 200, t2: 10, p2: 100 };
  const at = (r: number) => {
    const hit = fibLevels(d).find((l) => l.ratio === r);
    assert.ok(hit, `no ${r} level`);
    return hit.price;
  };
  assert.equal(at(0), 100);
  assert.equal(at(1), 200);
  assert.equal(at(0.382), 100 + 0.382 * 100, "levels sit above the low on a down move");
});

test("an extension projects beyond the end of the swing", () => {
  const d = { id: "c", kind: "fibext" as const, t1: 0, p1: 100, t2: 10, p2: 200 };
  const at = (r: number) => {
    const hit = fibLevels(d).find((l) => l.ratio === r);
    assert.ok(hit, `no ${r} level`);
    return hit.price;
  };
  assert.equal(at(1), 200, "100% is the end of the measured move");
  assert.ok(at(1.618) > 200, "extensions must lie past the end, not inside the move");
  assert.ok(Math.abs(at(1.618) - 261.8) < 1e-9);
  assert.ok(Math.abs(at(2.618) - 361.8) < 1e-9);
});

test("every retracement level lies inside the swing", () => {
  const d = { id: "d", kind: "fib" as const, t1: 0, p1: 137, t2: 9, p2: 421 };
  for (const l of fibLevels(d)) {
    assert.ok(l.price >= 137 - 1e-9 && l.price <= 421 + 1e-9,
      `${l.ratio} produced ${l.price}, outside the swing`);
  }
});

test("a flat swing produces levels but no range", () => {
  const d = { id: "e", kind: "fib" as const, t1: 0, p1: 50, t2: 5, p2: 50 };
  assert.ok(fibLevels(d).every((l) => l.price === 50));
});

test("hit-testing finds the nearest level and ignores bars before the drawing", () => {
  const d = { id: "f", kind: "fib" as const, t1: 100, p1: 100, t2: 200, p2: 200 };
  assert.equal(distanceToFib(d, 150, 150), 0, "the 50% level is an exact hit");
  assert.ok(Math.abs(distanceToFib(d, 150, 152) - 2) < 1e-9);
  assert.equal(distanceToFib(d, 50, 150), Infinity, "clicking to the left of the anchors misses");
});

test("Fibonacci drawings survive a save and reload", () => {
  const list = [
    { id: "g", kind: "fib" as const, t1: 1, p1: 10, t2: 2, p2: 20 },
    { id: "h", kind: "fibext" as const, t1: 3, p1: 30, t2: 4, p2: 40 },
  ];
  assert.deepEqual(parseDrawings(serializeDrawings(list)), list);
});

test("a corrupt Fibonacci entry is dropped, not rendered with NaN", () => {
  const raw = JSON.stringify([
    { id: "i", kind: "fib", t1: 1, p1: null, t2: 2, p2: 20 },
    { id: "j", kind: "fib", t1: 1, p1: 10, t2: 2, p2: 20 },
  ]);
  const out = parseDrawings(raw);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, "j");
});

const chan = (over = {}) => ({
  id: "c", kind: "channel" as const,
  t1: 0, p1: 100, t2: 10, p2: 120, t3: 5, p3: 130, ...over,
});

test("the parallel edge passes exactly through the third point", () => {
  const d = chan();
  assert.equal(channelPrices(d, d.t3).parallel, d.p3);
});

test("the two edges never converge or cross", () => {
  const d = chan();
  const gaps = [-50, 0, 3, 10, 40].map((t) => {
    const { base, parallel } = channelPrices(d, t);
    return parallel - base;
  });
  // Every gap identical is what "parallel" means; a channel that narrows is the
  // classic bug, and it looks almost right until the edges touch.
  assert.equal(new Set(gaps.map((g) => g.toFixed(9))).size, 1, `gaps drifted: ${gaps.join(", ")}`);
});

test("the baseline still runs through points one and two", () => {
  const d = chan();
  assert.equal(channelPrices(d, 0).base, 100);
  assert.equal(channelPrices(d, 10).base, 120);
});

test("a third point below the baseline puts the channel below it", () => {
  const d = chan({ t3: 5, p3: 90 });
  assert.ok(channelOffset(d) < 0);
  assert.equal(channelPrices(d, 5).parallel, 90);
  assert.equal(channelPrices(d, 5).base, 110);
});

test("a third point sitting on the baseline gives a channel of zero width", () => {
  const d = chan({ t3: 5, p3: 110 });
  assert.equal(channelOffset(d), 0);
});

test("a vertical baseline does not produce NaN prices", () => {
  const d = chan({ t1: 5, t2: 5 });
  for (const t of [0, 5, 10]) {
    const { base, parallel } = channelPrices(d, t);
    assert.ok(Number.isFinite(base) && Number.isFinite(parallel), `t=${t} gave ${base}/${parallel}`);
  }
});

test("hit-testing answers for both edges, not just the baseline", () => {
  const d = chan();
  const norm = { t: (v: number) => v / 10, p: (v: number) => (v - 100) / 40 };
  const onBase = distanceToChannel(d, 5, 110, norm);
  const onParallel = distanceToChannel(d, 5, 130, norm);
  assert.ok(onBase < 1e-9, `baseline should be an exact hit, got ${onBase}`);
  assert.ok(onParallel < 1e-9, `parallel edge should be an exact hit, got ${onParallel}`);
  assert.ok(distanceToChannel(d, 5, 120, norm) > 0.1, "the middle of the channel is not an edge");
});

test("channels survive a save and reload", () => {
  const list = [chan()];
  assert.deepEqual(parseDrawings(serializeDrawings(list)), list);
});

test("a channel missing its third point is dropped", () => {
  const raw = JSON.stringify([
    { id: "x", kind: "channel", t1: 0, p1: 1, t2: 1, p2: 2 },
    { id: "y", kind: "channel", t1: 0, p1: 1, t2: 1, p2: 2, t3: 0.5, p3: 3 },
  ]);
  const out = parseDrawings(raw);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, "y");
});
