import test from "node:test";
import assert from "node:assert/strict";
import { canonicalRedirect, isAdminPath, localeSegmentOk } from "./routing.ts";

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

const DOMAIN = "https://cophieuviet.vn";

test("the old vercel host redirects to the domain in production", () => {
  assert.equal(canonicalRedirect("vn-terminal.vercel.app", DOMAIN, "production"), "cophieuviet.vn");
});

test("a preview deploy is never dragged to production", () => {
  // The whole point of a preview is to serve something the live site does not.
  assert.equal(canonicalRedirect("vn-terminal-git-x.vercel.app", DOMAIN, "preview"), null);
  assert.equal(canonicalRedirect("vn-terminal.vercel.app", DOMAIN, undefined), null);
  assert.equal(canonicalRedirect("vn-terminal.vercel.app", DOMAIN, "development"), null);
});

test("with no domain configured the host redirects to itself, so it does not", () => {
  // Before NEXT_PUBLIC_SITE_URL is set, siteUrl() IS the vercel origin. A
  // redirect here would be an infinite loop on every page of the live site.
  assert.equal(
    canonicalRedirect("vn-terminal.vercel.app", "https://vn-terminal.vercel.app", "production"),
    null,
  );
  assert.equal(
    canonicalRedirect("VN-Terminal.Vercel.App", "https://vn-terminal.vercel.app", "production"),
    null,
  );
});

test("a request already on the domain is left alone", () => {
  assert.equal(canonicalRedirect("cophieuviet.vn", DOMAIN, "production"), null);
  // Not a general canonicaliser: a second custom domain is somebody's decision,
  // not a mistake to correct.
  assert.equal(canonicalRedirect("staging.example.com", DOMAIN, "production"), null);
});

test("a missing or unusable value never produces a redirect", () => {
  assert.equal(canonicalRedirect(null, DOMAIN, "production"), null);
  assert.equal(canonicalRedirect("vn-terminal.vercel.app", "not a url", "production"), null);
});

test("a port on the incoming host does not defeat the comparison", () => {
  assert.equal(canonicalRedirect("vn-terminal.vercel.app:443", DOMAIN, "production"), "cophieuviet.vn");
});
