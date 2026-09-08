import test from "node:test";
import assert from "node:assert/strict";
import { isAdminPath, localeSegmentOk } from "./routing.ts";

test("a segment spelled for its own locale is fine", () => {
  assert.ok(localeSegmentOk("/vi/vang"));
  assert.ok(localeSegmentOk("/en/gold"));
  assert.ok(localeSegmentOk("/vi/bieu-do/VNM"));
  assert.ok(localeSegmentOk("/en/chart/VNM"));
});

test("the other locale's spelling is refused", () => {
  // The same page at a second URL is what `guard()` has always refused, so
  // crawlers never index both.
  assert.ok(!localeSegmentOk("/vi/gold"));
  assert.ok(!localeSegmentOk("/en/vang"));
  assert.ok(!localeSegmentOk("/vi/chart/VNM"));
  assert.ok(!localeSegmentOk("/en/bieu-do/VNM"));
  assert.ok(!localeSegmentOk("/vi/pricing"));
  assert.ok(!localeSegmentOk("/en/goi-dich-vu"));
});

test("a segment identical in both locales is never a mispairing", () => {
  assert.ok(localeSegmentOk("/vi/crypto"));
  assert.ok(localeSegmentOk("/en/crypto"));
  assert.ok(localeSegmentOk("/vi/admin"));
  assert.ok(localeSegmentOk("/en/admin"));
});

test("an unknown segment is not ours to refuse", () => {
  // This decides MISPAIRING, not existence: a route that does not exist is
  // Next's 404 to give, and claiming it here would hide real 404s behind a
  // rule that has nothing to say about them.
  assert.ok(localeSegmentOk("/vi/nope"));
  assert.ok(localeSegmentOk("/en/whatever/deep"));
});

test("the locale root and non-locale paths pass through", () => {
  assert.ok(localeSegmentOk("/vi"));
  assert.ok(localeSegmentOk("/"));
  assert.ok(localeSegmentOk("/robots.txt"));
  assert.ok(localeSegmentOk("/fr/gold"), "not a locale we serve");
});

test("the admin path is recognised in both locales", () => {
  assert.ok(isAdminPath("/vi/admin"));
  assert.ok(isAdminPath("/en/admin"));
});

test("nothing else is the admin path", () => {
  // A prefix match would gate unrelated routes, and a loose one would miss it.
  assert.ok(!isAdminPath("/vi/administrator"));
  assert.ok(!isAdminPath("/vi/admin/orders"));
  assert.ok(!isAdminPath("/admin"));
  assert.ok(!isAdminPath("/vi"));
  assert.ok(!isAdminPath("/fr/admin"));
});

test("trailing slashes do not change the decision", () => {
  assert.ok(isAdminPath("/vi/admin/"));
  assert.ok(!localeSegmentOk("/vi/gold/"));
});
