import assert from "node:assert/strict";
import test from "node:test";
import { gaId, gaPayload } from "./ga.ts";

test("only a well-formed measurement id turns GA on", () => {
  assert.equal(gaId("G-ABC123XYZ"), "G-ABC123XYZ");
  assert.equal(gaId("  g-abc123  "), "G-ABC123");
  assert.equal(gaId(""), null);
  assert.equal(gaId("   "), null);
  assert.equal(gaId("UA-12345-1"), null);
  // The id is inlined into a script, so anything but the plain form is refused.
  assert.equal(gaId("G-1');alert(1)//"), null);
});

test("PostHog's own events, page views included, are not forwarded", () => {
  assert.equal(gaPayload("$pageview", { path: "/vi" }), null);
  assert.equal(gaPayload("$identify", {}), null);
});

test("event names are made valid for GA", () => {
  assert.equal(gaPayload("chart_type_changed", {})?.name, "chart_type_changed");
  assert.equal(gaPayload("chart-type.changed", {})?.name, "chart_type_changed");
  assert.equal(gaPayload("9lives", {})?.name, "lives");
  assert.equal(gaPayload("x".repeat(60), {})?.name.length, 40);
  assert.equal(gaPayload("123", {}), null);
});

test("only plain values travel, trimmed to GA's limits", () => {
  const p = gaPayload("chart_viewed", {
    symbol: "VNM", bars: 120, intraday: false, nested: { a: 1 }, list: [1], none: null, nan: Number.NaN,
    long: "y".repeat(150), "bad-key": "ok",
  });
  assert.deepEqual(Object.keys(p?.params ?? {}).sort(), ["bad_key", "bars", "intraday", "long", "symbol"]);
  assert.equal((p?.params.long as string).length, 100);
  const many = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`k${i}`, i]));
  assert.equal(Object.keys(gaPayload("e", many)?.params ?? {}).length, 25);
});
