import assert from "node:assert/strict";
import test from "node:test";
import { sameOrigin } from "./same-origin.ts";

const URL_UNDER_TEST = "https://vnt.example.com/api/billing/revoke";

function withSite<T>(site: string | undefined, fn: () => T): T {
  const saved = process.env.NEXT_PUBLIC_SITE_URL;
  try {
    if (site === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = site;
    return fn();
  } finally {
    if (saved === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = saved;
  }
}

const post = (headers: Record<string, string>) =>
  new Request(URL_UNDER_TEST, { method: "POST", headers });

test("a fetch from our own page is same-origin", () => {
  assert.equal(sameOrigin(post({ "sec-fetch-site": "same-origin" })), true);
});

test("a link opened from the address bar or a bookmark is allowed", () => {
  // `none` is a user-initiated navigation, which is not a cross-site forgery.
  assert.equal(sameOrigin(post({ "sec-fetch-site": "none" })), true);
});

test("a POST from another site is refused", () => {
  assert.equal(sameOrigin(post({ "sec-fetch-site": "cross-site" })), false);
});

test("a POST from a sibling subdomain is refused", () => {
  // `same-site` is not `same-origin`: a subdomain someone else controls is not us.
  assert.equal(sameOrigin(post({ "sec-fetch-site": "same-site" })), false);
});

test("an old browser proves itself with Origin instead", () => {
  assert.equal(
    withSite("https://vnt.example.com", () => sameOrigin(post({ origin: "https://vnt.example.com" }))),
    true,
  );
});

test("an old browser posting from elsewhere is refused", () => {
  assert.equal(
    withSite("https://vnt.example.com", () => sameOrigin(post({ origin: "https://evil.example" }))),
    false,
  );
});

test("a request carrying neither header is not a browser we can vouch for", () => {
  // This is also why the provider webhooks are signature-checked, not gated here.
  assert.equal(withSite("https://vnt.example.com", () => sameOrigin(post({}))), false);
});

test("the configured origin decides, not the Host the request arrived on", () => {
  // A poisoned Host would otherwise let an attacker's origin vouch for itself.
  assert.equal(
    withSite("https://vnt.example.com", () => sameOrigin(post({ origin: "https://vnt.example.com" }))),
    true,
  );
  assert.equal(
    withSite("https://canonical.example.com", () => sameOrigin(post({ origin: "https://vnt.example.com" }))),
    false,
  );
});

test("a site url written with a trailing slash still matches", () => {
  assert.equal(
    withSite("https://vnt.example.com/", () => sameOrigin(post({ origin: "https://vnt.example.com" }))),
    true,
  );
});

test("with no canonical origin configured the request's own origin is used", () => {
  assert.equal(withSite(undefined, () => sameOrigin(post({ origin: "https://vnt.example.com" }))), true);
  assert.equal(withSite(undefined, () => sameOrigin(post({ origin: "https://evil.example" }))), false);
});
