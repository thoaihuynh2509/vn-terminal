import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_TEXT_LEN, anchorsOf, channelOffset, channelPrices, distanceToChannel, distanceToFib, distanceToHLine, distanceToRay, distanceToRect, distanceToTrend, fibLevels, hitAnchor, hitTest, moveAnchor, parseDrawings, serializeDrawings, storageKey, translate, trendPriceAt, type Drawing, type TrendLine,
} from "./drawings.ts";

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

// ── P2-12: new kinds, anchors, move, unified hit-testing ────────────
const NRM = { t: (v: number) => v / 100, p: (v: number) => v / 100 };

const seg = (kind: "trend" | "ray" | "rect" | "measure" | "fib" | "fibext") =>
  ({ id: "x", kind, t1: 0, p1: 0, t2: 100, p2: 100 }) as Drawing;

test("every kind exposes anchors a reader can grab", () => {
  const all: Drawing[] = [
    { id: "a", kind: "hline", price: 10 },
    { id: "b", kind: "vline", t: 5 },
    { id: "c", kind: "trade", t: 5, price: 10 },
    { id: "d", kind: "text", t: 5, price: 10, text: "note" },
    { id: "e", kind: "channel", t1: 0, p1: 0, t2: 10, p2: 10, t3: 0, p3: 5 },
    seg("trend"), seg("ray"), seg("rect"), seg("measure"),
  ];
  for (const d of all) assert.ok(anchorsOf(d).length >= 1, d.kind);
  assert.equal(anchorsOf(all[4]).length, 3, "a channel has three");
});

test("an anchor only claims the axes its drawing actually has", () => {
  // A handle that let a reader drag an hline sideways would offer a change the
  // model cannot store.
  assert.equal(anchorsOf({ id: "a", kind: "hline", price: 10 })[0].axis, "price");
  assert.equal(anchorsOf({ id: "b", kind: "vline", t: 5 })[0].axis, "time");
  assert.equal(anchorsOf(seg("trend"))[0].axis, "both");
});

test("moving an anchor changes that point and no other", () => {
  const moved = moveAnchor(seg("trend"), 1, 50, 25) as Extract<Drawing, { kind: "trend" }>;
  assert.equal(moved.t1, 0);
  assert.equal(moved.p1, 0);
  assert.equal(moved.t2, 50);
  assert.equal(moved.p2, 25);
});

test("moving an hline's handle changes its price, never a time", () => {
  const moved = moveAnchor({ id: "a", kind: "hline", price: 10 }, 0, 999, 42);
  assert.deepEqual(moved, { id: "a", kind: "hline", price: 42 });
});

test("moving a vline's handle changes its time, never a price", () => {
  const moved = moveAnchor({ id: "b", kind: "vline", t: 5 }, 0, 77, 999);
  assert.deepEqual(moved, { id: "b", kind: "vline", t: 77 });
});

test("an anchor index that does not exist changes nothing", () => {
  const d = seg("trend");
  assert.equal(moveAnchor(d, 5, 1, 1), d);
  assert.equal(moveAnchor({ id: "a", kind: "hline", price: 10 }, 3, 1, 1).id, "a");
});

test("translating keeps a drawing's shape", () => {
  const before = seg("trend") as Extract<Drawing, { kind: "trend" }>;
  const after = translate(before, 10, -5) as Extract<Drawing, { kind: "trend" }>;
  assert.equal(after.t2 - after.t1, before.t2 - before.t1);
  assert.equal(after.p2 - after.p1, before.p2 - before.p1);
  assert.equal(after.t1, 10);
  assert.equal(after.p1, -5);
});

test("translating a channel carries its third point too", () => {
  const c = { id: "c", kind: "channel", t1: 0, p1: 0, t2: 10, p2: 10, t3: 0, p3: 5 } as Drawing;
  const m = translate(c, 5, 5) as Extract<Drawing, { kind: "channel" }>;
  // The width must be preserved, or dragging a channel reshapes it.
  assert.equal(channelOffset(m), channelOffset(c as Extract<Drawing, { kind: "channel" }>));
  assert.equal(m.t3, 5);
});

test("translating an hline ignores the time delta it cannot hold", () => {
  const m = translate({ id: "a", kind: "hline", price: 10 }, 500, 2);
  assert.deepEqual(m, { id: "a", kind: "hline", price: 12 });
});

test("a ray keeps mattering past its second point; a segment does not", () => {
  // The whole reason to store which one the reader meant.
  const far = { t: 400, p: 400 };
  const onLine = distanceToRay(seg("ray") as never, far.t, far.p, NRM);
  const offEnd = distanceToTrend(seg("trend") as never, far.t, far.p, NRM);
  assert.ok(onLine < 1e-9, `ray should still be hit: ${onLine}`);
  assert.ok(offEnd > 1, `segment should not: ${offEnd}`);
});

test("a ray does not extend backwards from its first point", () => {
  const behind = distanceToRay(seg("ray") as never, -200, -200, NRM);
  assert.ok(behind > 1, `${behind}`);
});

test("a rectangle is grabbed by its outline, not by its whole area", () => {
  // Zero distance inside would make a box swallow every click over the region
  // it covers, including drawings beneath it.
  const inside = distanceToRect(seg("rect") as never, 50, 50, NRM);
  assert.ok(inside > 0.1, `centre should not be a hit: ${inside}`);
  const onEdge = distanceToRect(seg("rect") as never, 50, 0, NRM);
  assert.ok(onEdge < 1e-9, `edge should be a hit: ${onEdge}`);
});

test("hit-testing finds the nearest drawing within tolerance", () => {
  const near: Drawing = { id: "near", kind: "hline", price: 10 };
  const far: Drawing = { id: "far", kind: "hline", price: 90 };
  assert.equal(hitTest([far, near], 0, 10.2, NRM, 0.05)?.id, "near");
  assert.equal(hitTest([far, near], 0, 50, NRM, 0.05), null);
});

test("when two drawings overlap the one on top is grabbed", () => {
  // Ties go to the drawing added last; picking the older one would leave a
  // reader unable to grab the thing they can see.
  const a: Drawing = { id: "under", kind: "hline", price: 10 };
  const b: Drawing = { id: "over", kind: "hline", price: 10 };
  assert.equal(hitTest([a, b], 0, 10, NRM, 0.05)?.id, "over");
});

test("an anchor is found only when the click is close to it", () => {
  const d = seg("trend");
  assert.equal(hitAnchor(d, 0, 0, NRM, 0.05), 0);
  assert.equal(hitAnchor(d, 100, 100, NRM, 0.05), 1);
  assert.equal(hitAnchor(d, 50, 50, NRM, 0.05), -1);
});

test("an hline's handle is grabbed by price alone, at any time", () => {
  // It is drawn at a fixed x, so requiring a time match would make it
  // ungrabbable wherever the reader clicked.
  assert.equal(hitAnchor({ id: "a", kind: "hline", price: 10 }, 99999, 10, NRM, 0.05), 0);
});

test("the new kinds survive being stored and read back", () => {
  const all: Drawing[] = [
    { id: "r", kind: "ray", t1: 1, p1: 2, t2: 3, p2: 4 },
    { id: "v", kind: "vline", t: 7 },
    { id: "b", kind: "rect", t1: 1, p1: 2, t2: 3, p2: 4 },
    { id: "n", kind: "text", t: 1, price: 2, text: "earnings" },
    { id: "m", kind: "measure", t1: 1, p1: 2, t2: 3, p2: 4 },
  ];
  assert.deepEqual(parseDrawings(serializeDrawings(all)), all);
});

test("a note with no text is not storable", () => {
  // It would render as an invisible drawing the reader cannot find to delete.
  assert.deepEqual(parseDrawings('[{"id":"n","kind":"text","t":1,"price":2,"text":""}]'), []);
  assert.deepEqual(parseDrawings('[{"id":"n","kind":"text","t":1,"price":2}]'), []);
});

test("an over-long note is refused rather than truncated on read", () => {
  const long = JSON.stringify([{ id: "n", kind: "text", t: 1, price: 2, text: "x".repeat(MAX_TEXT_LEN + 1) }]);
  assert.deepEqual(parseDrawings(long), []);
});

test("a malformed new-kind drawing is dropped, not half-read", () => {
  assert.deepEqual(parseDrawings('[{"id":"v","kind":"vline"}]'), []);
  assert.deepEqual(parseDrawings('[{"id":"r","kind":"ray","t1":1,"p1":2}]'), []);
});
