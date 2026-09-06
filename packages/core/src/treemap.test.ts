import assert from "node:assert/strict";
import test from "node:test";
import { squarify } from "./treemap.ts";

const W = 100, H = 100;
const mk = (weights: number[]) => weights.map((weight, i) => ({ item: `t${i}`, weight }));

test("every item is placed exactly once", () => {
  const boxes = squarify(mk([5, 3, 2, 8, 1, 6]), 0, 0, W, H);
  assert.equal(boxes.length, 6);
  assert.equal(new Set(boxes.map((b) => b.item)).size, 6);
});

test("boxes fill the rectangle without gaps", () => {
  const weights = [5, 3, 2, 8, 1, 6, 4, 7];
  const boxes = squarify(mk(weights), 0, 0, W, H);
  const area = boxes.reduce((s, b) => s + b.w * b.h, 0);
  assert.ok(Math.abs(area - W * H) < 0.01, `covered ${area}, expected ${W * H}`);
});

test("area is proportional to weight", () => {
  const weights = [10, 20, 30, 40];
  const boxes = squarify(mk(weights), 0, 0, W, H);
  const total = weights.reduce((a, b) => a + b, 0);
  boxes.forEach((b, i) => {
    const expected = (weights[i] / total) * W * H;
    assert.ok(Math.abs(b.w * b.h - expected) < 0.01, `${b.item}: ${b.w * b.h} vs ${expected}`);
  });
});

test("no two boxes overlap", () => {
  const boxes = squarify(mk([9, 1, 5, 3, 7, 2, 6, 4, 8]), 0, 0, W, H);
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      const overlap =
        Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
        Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
      assert.ok(overlap < 1e-6, `${a.item} overlaps ${b.item} by ${overlap}`);
    }
  }
});

test("boxes stay inside the bounds", () => {
  for (const b of squarify(mk([3, 1, 4, 1, 5, 9, 2, 6]), 0, 0, W, H)) {
    assert.ok(b.x >= -1e-9 && b.y >= -1e-9);
    assert.ok(b.x + b.w <= W + 1e-9, `${b.item} overflows right`);
    assert.ok(b.y + b.h <= H + 1e-9, `${b.item} overflows bottom`);
  }
});

test("degenerate inputs return nothing rather than NaN geometry", () => {
  assert.deepEqual(squarify([], 0, 0, W, H), []);
  assert.deepEqual(squarify(mk([0, 0]), 0, 0, W, H), []);
  assert.deepEqual(squarify(mk([1, 2]), 0, 0, 0, H), []);
  for (const b of squarify(mk([1, -5, 2]), 0, 0, W, H)) {
    assert.ok(Number.isFinite(b.w) && Number.isFinite(b.h));
  }
});
