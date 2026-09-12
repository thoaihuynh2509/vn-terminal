import { test } from "node:test";
import assert from "node:assert/strict";
import { heikinAshi, isChartType } from "./chart-types.ts";

test("only the offered styles are chart types", () => {
  assert.equal(isChartType("heikin"), true);
  assert.equal(isChartType("renko"), false);
  assert.equal(isChartType(undefined), false);
});

test("a Heikin Ashi bar averages its own prices and the previous body", () => {
  const [a, b] = heikinAshi([
    { t: 1, o: 10, h: 14, l: 9, c: 12 },
    { t: 2, o: 12, h: 13, l: 11, c: 11 },
  ]);
  assert.equal(a.c, (10 + 14 + 9 + 12) / 4);
  assert.equal(a.o, (10 + 12) / 2);
  assert.equal(b.o, (a.o + a.c) / 2);
  assert.equal(b.c, (12 + 13 + 11 + 11) / 4);
});

test("a Heikin Ashi bar's wicks always contain its body", () => {
  for (const x of heikinAshi([{ o: 5, h: 5.1, l: 4.9, c: 5 }, { o: 9, h: 9.2, l: 8.8, c: 9.1 }])) {
    assert.ok(x.h >= Math.max(x.o, x.c) && x.l <= Math.min(x.o, x.c));
  }
});
