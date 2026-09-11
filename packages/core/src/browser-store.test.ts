import { test } from "node:test";
import assert from "node:assert/strict";
import { storeSubscriber } from "./browser-store.ts";

test("a key keeps one subscribe function, so a reader does not resubscribe every render", () => {
  assert.equal(storeSubscriber("drawings:VNM"), storeSubscriber("drawings:VNM"));
});

test("different keys get different subscribe functions", () => {
  assert.notEqual(storeSubscriber("drawings:VNM"), storeSubscriber("drawings:FPT"));
});
