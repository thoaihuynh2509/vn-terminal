/**
 * Magic-link primitives: token entropy, hashing, and redirect validation.
 *
 * These are the three places where a magic link becomes a security control
 * rather than a convenience, so each is tested as a fact on its own.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { generateToken, hashToken, linkOrigin, safeRedirect, magicLinkUrl } from "./magic.ts";
import { resolveTier } from "./provider.ts";
import type { UserRecord } from "../db/types.ts";

// ── token entropy ───────────────────────────────────────────────────────────

test("a minted token is 32 bytes of entropy encoded base64url", () => {
  const t = generateToken();
  assert.equal(t.length, 43, "43 base64url chars is 32 bytes");
  assert.match(t, /^[A-Za-z0-9_-]{43}$/, "base64url only — the token travels in a URL");
});

test("minted tokens do not repeat", () => {
  const seen = new Set(Array.from({ length: 200 }, () => generateToken()));
  assert.equal(seen.size, 200, "a guessable or repeated token is an account takeover");
});

// ── hashing ─────────────────────────────────────────────────────────────────

test("hashToken returns 64 lowercase hex characters", async () => {
  assert.match(await hashToken("test-raw-token"), /^[0-9a-f]{64}$/);
});

test("hashToken is deterministic", async () => {
  assert.equal(await hashToken("test-raw-token"), await hashToken("test-raw-token"));
});

test("hashToken is SHA-256 of the raw token", async () => {
  assert.equal(
    await hashToken("test-raw-token"),
    createHash("sha256").update("test-raw-token").digest("hex"),
  );
});

test("different tokens hash differently", async () => {
  assert.notEqual(await hashToken("test-raw-token-a"), await hashToken("test-raw-token-b"));
});

// ── open redirect ───────────────────────────────────────────────────────────

test("safeRedirect refuses anything that can leave this origin", () => {
  const hostile = [
    "//evil.com",
    "/\\evil.com",
    "\\\\evil.com",
    "https://evil.com",
    "http://evil.com",
    "javascript:alert(1)",
    "",
  ];
  for (const v of hostile) {
    assert.equal(safeRedirect(v, "vi"), "/vi", `${JSON.stringify(v)} must not survive`);
  }
});

test("safeRedirect refuses a path belonging to another locale", () => {
  assert.equal(safeRedirect("/en/x", "vi"), "/vi");
});

test("safeRedirect refuses a path that merely shares the locale prefix", () => {
  assert.equal(safeRedirect("/vivid/x", "vi"), "/vi", "/vi must be a segment, not a prefix");
});

test("safeRedirect refuses a missing value", () => {
  assert.equal(safeRedirect(null, "vi"), "/vi");
  assert.equal(safeRedirect(undefined, "vi"), "/vi");
});

test("safeRedirect keeps a same-origin path inside the locale, query included", () => {
  assert.equal(safeRedirect("/vi/bieu-do/VNM?rail=watch", "vi"), "/vi/bieu-do/VNM?rail=watch");
});

test("safeRedirect keeps the locale root itself", () => {
  assert.equal(safeRedirect("/vi", "vi"), "/vi");
});

test("safeRedirect falls back to the locale it was asked about", () => {
  assert.equal(safeRedirect("https://evil.com", "en"), "/en");
});

// ── the emailed link ────────────────────────────────────────────────────────

async function withSiteUrl<T>(value: string | undefined, fn: () => T): Promise<T> {
  const saved = process.env.NEXT_PUBLIC_SITE_URL;
  try {
    if (value === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = value;
    return fn();
  } finally {
    if (saved === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = saved;
  }
}

test("the link origin comes from configuration", async () => {
  const link = await withSiteUrl("https://vnt.example.com", () => magicLinkUrl("test-token", "vi"));
  assert.equal(new URL(link).origin, "https://vnt.example.com");
});

test("a host-shaped token cannot move the link to another origin", async () => {
  // The signature takes no host, and the token is the only caller-supplied part.
  const link = await withSiteUrl("https://vnt.example.com", () =>
    magicLinkUrl("evil.com/x", "vi"),
  );
  assert.equal(
    new URL(link).origin,
    "https://vnt.example.com",
    "a link mailed to a victim must always point at our origin",
  );
});

test("a token containing URL syntax survives the round trip intact", async () => {
  // An unencoded '#' would silently truncate the token and every link would fail.
  const token = "a+b/c=d&e#f?g";
  const link = await withSiteUrl("https://vnt.example.com", () => magicLinkUrl(token, "vi"));
  assert.equal(new URL(link).searchParams.get("token"), token);
});

test("a trailing slash on the configured origin does not double up", async () => {
  const link = await withSiteUrl("https://vnt.example.com//", () => magicLinkUrl("t", "vi"));
  assert.equal(new URL(link).pathname, "/vi/dang-nhap/verify");
});

test("the verify path is localised per locale", async () => {
  const vi = await withSiteUrl("https://vnt.example.com", () => magicLinkUrl("t", "vi"));
  const en = await withSiteUrl("https://vnt.example.com", () => magicLinkUrl("t", "en"));
  assert.equal(new URL(vi).pathname, "/vi/dang-nhap/verify");
  assert.equal(new URL(en).pathname, "/en/login/verify");
});

test("an unconfigured origin refuses to mint a link at all", async () => {
  // A guessed default mails a live bearer token to whichever deployment owns
  // that domain, which a fork or a preview does not. Refusing is the only safe
  // answer; the request route resolves this before minting a token.
  await withSiteUrl(undefined, () => {
    assert.throws(() => magicLinkUrl("t", "vi"), /NEXT_PUBLIC_SITE_URL/);
  });
});

test("linkOrigin normalises the configured origin and reports an absent one", async () => {
  assert.equal(await withSiteUrl("https://vnt.example.com//", linkOrigin), "https://vnt.example.com");
  assert.equal(await withSiteUrl(undefined, linkOrigin), null);
});

// ── tier is a property of the account, never of the request ─────────────────

const user = (tier: UserRecord["tier"]): UserRecord => ({
  id: "00000000-0000-4000-8000-000000000001",
  email: "test-albert@example.com",
  tier,
  tierExpiresAt: null,
  renewalRemindedAt: null,
  referralCode: "TESTCODE",
  referredBy: null,
  referralRewardedAt: null,
  marketingOptOut: false,
  teaserSentAt: null,
  createdAt: new Date("2026-09-05T10:00:00.000Z"),
});

test("resolveTier returns the tier stored on the user record", () => {
  assert.equal(resolveTier(user("pro")), "pro");
  assert.equal(resolveTier(user("plus")), "plus");
  assert.equal(resolveTier(user("free")), "free");
});

test("resolveTier ignores request-shaped input travelling alongside the record", () => {
  // A caller must not be able to talk itself into a tier the account has not been granted.
  const smuggled: UserRecord & { requestedTier: string } = { ...user("plus"), requestedTier: "pro" };
  assert.equal(resolveTier(smuggled), "plus");
});
