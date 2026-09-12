import { test } from "node:test";
import assert from "node:assert/strict";
import { alignByTime } from "./series-align.ts";

test("a prepended page of history shifts no value onto the wrong bar", () => {
  const source = [{ t: 30 }, { t: 40 }];
  assert.deepEqual(alignByTime(source, [3, 4], [{ t: 10 }, { t: 20 }, { t: 30 }, { t: 40 }]), [null, null, 3, 4]);
});

test("a missing value stays null rather than borrowing a neighbour's", () => {
  assert.deepEqual(alignByTime([{ t: 1 }, { t: 2 }], [null, 5], [{ t: 1 }, { t: 2 }, { t: 3 }]), [null, 5, null]);
});

test("a source shorter than its bars reads as null past its end", () => {
  assert.deepEqual(alignByTime([{ t: 1 }, { t: 2 }], [7], [{ t: 1 }, { t: 2 }]), [7, null]);
});

test("a series that only grew at the end keeps its head", async () => {
  const { sameHead } = await import("./series-align.ts");
  assert.ok(sameHead([1, 2, null], [1, 2, null, 4], 3));
  assert.ok(sameHead([NaN, 1], [NaN, 1, 2], 2));
  assert.ok(!sameHead([1, 2, 3], [1, 9, 3, 4], 3));
  assert.ok(!sameHead([1], [1, 2, 3], 2));
  assert.ok(!sameHead(undefined, [1], 0));
});
