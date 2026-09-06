import assert from "node:assert/strict";
import test from "node:test";
import { newReferralCode, normalizeCode, REFERRAL_REWARD_DAYS } from "./referral.ts";

test("a referral code is 8 unambiguous chars and unique across a large sample", () => {
  const seen = new Set(Array.from({ length: 500 }, () => newReferralCode()));
  for (const c of seen) assert.match(c, /^[A-HJ-NP-Z2-9]{8}$/, "no O/0 or I/1");
  assert.ok(seen.size > 495, "codes must not collide in practice");
});

test("normalizeCode upper-cases and validates, rejecting junk", () => {
  assert.equal(normalizeCode("abc123"), "ABC123");
  assert.equal(normalizeCode("  code2024  "), "CODE2024");
  assert.equal(normalizeCode("no"), null, "too short");
  assert.equal(normalizeCode("has space"), null);
  assert.equal(normalizeCode(42), null);
  assert.equal(normalizeCode(null), null);
});

test("the reward is a sane number of days", () => {
  assert.ok(REFERRAL_REWARD_DAYS > 0 && REFERRAL_REWARD_DAYS <= 90);
});
