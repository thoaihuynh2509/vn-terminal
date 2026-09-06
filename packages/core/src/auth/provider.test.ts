/**
 * Which sign-in provider is live.
 *
 * The load-bearing branch is `dev` in production: an unauthenticated
 * "become anyone" endpoint on a live site is a total auth bypass, so it must be
 * refused by the env resolver and not merely by a route guard.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { activeAuthProvider, effectiveTier, isDevAuth, looksLikeEmail } from "./provider.ts";
import type { UserRecord } from "../db/types.ts";

const KEYS = ["AUTH_PROVIDER", "NODE_ENV"] as const;

function withEnv<T>(vars: Record<string, string | undefined>, fn: () => T): T {
  const saved = new Map<string, string | undefined>(KEYS.map((k) => [k, process.env[k]]));
  try {
    for (const k of KEYS) delete process.env[k];
    for (const [k, v] of Object.entries(vars)) if (v !== undefined) process.env[k] = v;
    return fn();
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test("the dev provider is refused in production", () => {
  assert.equal(
    withEnv({ AUTH_PROVIDER: "dev", NODE_ENV: "production" }, activeAuthProvider),
    "disabled",
    "passwordless become-anyone sign-in must never be live",
  );
});

test("the dev provider is available outside production", () => {
  assert.equal(withEnv({ AUTH_PROVIDER: "dev", NODE_ENV: "development" }, activeAuthProvider), "dev");
});

test("the magic provider is available in production", () => {
  assert.equal(
    withEnv({ AUTH_PROVIDER: "magic", NODE_ENV: "production" }, activeAuthProvider),
    "magic",
    "the emailed-link provider is the one that is safe to ship",
  );
});

test("the magic provider can be selected outside production too", () => {
  assert.equal(withEnv({ AUTH_PROVIDER: "magic", NODE_ENV: "development" }, activeAuthProvider), "magic");
});

test("sign-in can be turned off explicitly", () => {
  assert.equal(withEnv({ AUTH_PROVIDER: "disabled", NODE_ENV: "development" }, activeAuthProvider), "disabled");
});

test("with nothing configured production has no provider", () => {
  assert.equal(withEnv({ NODE_ENV: "production" }, activeAuthProvider), "disabled");
});

test("with nothing configured a local checkout gets the dev provider", () => {
  assert.equal(withEnv({ NODE_ENV: "development" }, activeAuthProvider), "dev");
});

test("an unrecognised AUTH_PROVIDER falls back to the default, never to itself", () => {
  assert.equal(withEnv({ AUTH_PROVIDER: "oauth", NODE_ENV: "production" }, activeAuthProvider), "disabled");
  assert.equal(withEnv({ AUTH_PROVIDER: "oauth", NODE_ENV: "development" }, activeAuthProvider), "dev");
});

test("isDevAuth is true only for the dev provider", () => {
  assert.equal(withEnv({ AUTH_PROVIDER: "dev", NODE_ENV: "development" }, isDevAuth), true);
  assert.equal(withEnv({ AUTH_PROVIDER: "magic", NODE_ENV: "development" }, isDevAuth), false);
  assert.equal(withEnv({ AUTH_PROVIDER: "dev", NODE_ENV: "production" }, isDevAuth), false);
});

// looksLikeEmail is the only shape check standing in front of the magic-link
// request route, so its edges are worth pinning.
test("looksLikeEmail accepts an ordinary address", () => {
  assert.equal(looksLikeEmail("test-albert@example.com"), true);
  assert.equal(looksLikeEmail("test-albert+tag@sub.example.co.uk"), true);
});

test("looksLikeEmail rejects anything without one address shape", () => {
  for (const v of ["", "nope", "a@b", "a@b.c", "a b@example.com", "a@ex ample.com", "@example.com", "a@@b.co"]) {
    assert.equal(looksLikeEmail(v), false, `${JSON.stringify(v)} must be refused`);
  }
});

test("looksLikeEmail rejects a non-string", () => {
  for (const v of [null, undefined, 42, {}, ["a@b.co"]]) {
    assert.equal(looksLikeEmail(v), false);
  }
});

test("looksLikeEmail refuses an address past the 254-character limit", () => {
  const domain = "@example.com";
  const at254 = "t".repeat(254 - domain.length) + domain;
  assert.equal(at254.length, 254);
  assert.equal(looksLikeEmail(at254), true, "254 is the limit, not one past it");
  assert.equal(looksLikeEmail(`t${at254}`), false);
});

const rec = (tier: UserRecord["tier"], expires: Date | null): UserRecord => ({
  id: "u1", email: "test-albert@example.com", tier, tierExpiresAt: expires, renewalRemindedAt: null,
  referralCode: "TESTCODE", referredBy: null, referralRewardedAt: null,
  marketingOptOut: false, teaserSentAt: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
});

test("effectiveTier downgrades a paid row past its expiry to free", () => {
  const now = new Date("2026-06-01T00:00:00Z");
  assert.equal(effectiveTier(rec("pro", new Date("2026-05-01T00:00:00Z")), now), "free");
  assert.equal(effectiveTier(rec("pro", new Date("2026-07-01T00:00:00Z")), now), "pro");
  assert.equal(effectiveTier(rec("plus", null), now), "plus", "no expiry means no downgrade");
  assert.equal(effectiveTier(rec("free", null), now), "free");
});
