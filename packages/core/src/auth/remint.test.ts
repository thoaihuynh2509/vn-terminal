import assert from "node:assert/strict";
import test from "node:test";
import { carriedAsks, remintSession } from "./remint.ts";
import type { Session } from "./token.ts";
import type { UserRecord } from "../db/types.ts";

const NOW_SEC = Math.floor(Date.UTC(2026, 8, 8, 12) / 1000);

const user = (over: Partial<UserRecord> = {}): UserRecord => ({
  id: "u1",
  email: "test-albert@example.com",
  tier: "free",
  tierExpiresAt: null,
  renewalRemindedAt: null,
  referralCode: "ABC123",
  referredBy: null,
  referralRewardedAt: null,
  marketingOptOut: false,
  teaserSentAt: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  ...over,
});

test("a re-mint carries the free AI asks already spent", () => {
  const s = remintSession(user(), { read: [], asks: 2 }, NOW_SEC);
  assert.equal(s.asks, 2, "re-minting must not hand a spent meter back to zero");
});

test("a re-mint carries the member articles already read", () => {
  const s = remintSession(user(), { read: ["vi/bai-viet/a"], asks: 1 }, NOW_SEC);
  assert.deepEqual(s.read, ["vi/bai-viet/a"]);
});

test("a session minted from nothing starts with an empty read list", () => {
  const s = remintSession(user(), {}, NOW_SEC);
  assert.deepEqual(s.read, []);
});

test("a carry with no asks mints no asks key at all", () => {
  // decodeSession omits `asks` when unset; a minted `asks: undefined` would
  // serialise differently and stop the two shapes comparing equal.
  const s = remintSession(user(), { read: [] }, NOW_SEC);
  assert.ok(!("asks" in s), `asks must be absent, got ${JSON.stringify(s)}`);
});

test("the minted tier comes from the account row, never from the cookie", () => {
  const s = remintSession(user({ tier: "free" }), { read: [], tier: "pro" } as never, NOW_SEC);
  assert.equal(s.tier, "free", "a tampered cookie cannot mint itself a paid tier");
});

test("the minted expiry comes from the account row, never from the cookie", () => {
  const rowEnd = new Date("2026-10-08T12:00:00.000Z");
  const s = remintSession(user({ tier: "pro", tierExpiresAt: rowEnd }), { read: [], exp: 9_999_999_999 } as never, NOW_SEC);
  assert.equal(s.exp, Math.floor(rowEnd.getTime() / 1000));
});

test("an account with no subscription end mints no exp at all", () => {
  const s = remintSession(user({ tier: "plus", tierExpiresAt: null }), { read: [] }, NOW_SEC);
  assert.ok(!("exp" in s), `a comped account has no end, got ${JSON.stringify(s)}`);
});

test("a meter reading of zero survives a re-mint", () => {
  // 0 is falsy: the classic way a carried counter is dropped and a reader who
  // has spent nothing is indistinguishable from one with no meter at all.
  const s = remintSession(user(), { read: [], asks: 0 }, NOW_SEC);
  assert.equal(s.asks, 0);
});

test("a carry whose asks is explicitly undefined mints no asks key", () => {
  const s = remintSession(user(), { read: [], asks: undefined }, NOW_SEC);
  assert.ok(!("asks" in s), `asks must be absent, got ${JSON.stringify(s)}`);
});

test("a spent meter is carried whole, not clamped or reset", () => {
  const s = remintSession(user(), { read: [], asks: 2 }, NOW_SEC);
  assert.equal(s.asks, 2, "the free teaser is spent, and buying is the way past it");
});

test("the session is stamped with the instant it was minted", () => {
  assert.equal(remintSession(user(), {}, NOW_SEC).iat, NOW_SEC);
});

test("the minted email is the row's, not whatever the cookie claimed", () => {
  const s = remintSession(user({ email: "test-albert@example.com" }), { read: [], email: "attacker@example.com" } as never, NOW_SEC);
  assert.equal(s.email, "test-albert@example.com");
});

test("a paid row mints the tier it holds", () => {
  const s = remintSession(user({ tier: "pro", tierExpiresAt: new Date("2026-10-08T12:00:00.000Z") }), {}, NOW_SEC);
  assert.equal(s.tier, "pro");
});

test("an expired row still mints its own exp, so the cookie self-downgrades", () => {
  // remint does not decide entitlement; decodeSession serves a past exp as free.
  const past = new Date("2026-01-01T00:00:00.000Z");
  const s = remintSession(user({ tier: "pro", tierExpiresAt: past }), {}, NOW_SEC);
  assert.equal(s.exp, Math.floor(past.getTime() / 1000));
});

// ── whose free-AI meter is being carried ───────────────────────────────────

const priorSession = (email: string, asks: number): Session => ({
  email,
  tier: email ? "free" : "anon",
  read: [],
  iat: NOW_SEC,
  asks,
});

test("an anonymous meter carries into the account that signs in", () => {
  assert.equal(carriedAsks(priorSession("", 2), "test-albert@example.com"), 2, "signing in must not refill the teaser");
});

test("another reader's spent meter is not carried onto the account signing in", () => {
  assert.equal(carriedAsks(priorSession("test-other@example.com", 2), "test-albert@example.com"), undefined);
});

test("the same reader signing in again keeps their own meter", () => {
  assert.equal(carriedAsks(priorSession("Test-Albert@Example.com", 1), "test-albert@example.com"), 1, "case is not a different person");
});

test("no prior session carries nothing", () => {
  assert.equal(carriedAsks(null, "test-albert@example.com"), undefined);
});

test("a prior session that spent nothing carries its zero", () => {
  assert.equal(carriedAsks(priorSession("test-albert@example.com", 0), "test-albert@example.com"), 0);
});
