/**
 * Sliding-window limiter.
 *
 * The clock is faked for every window test: a limiter tested against the real
 * clock either sleeps for the window or asserts nothing about its edges, and
 * the edges are the whole behaviour.
 *
 * `limited(key)` returns TRUE when the call is over the ceiling.
 */
import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { clientIp, createLimiter } from "./rate-limit.ts";

const WINDOW = 60_000;

// ── the key a request counts against ────────────────────────────────────────

const asRequest = (headers: Record<string, string>) => new Request("https://test.example/api", { headers });

test("the trusted address is the rightmost forwarded entry, not the client's own", () => {
  assert.equal(
    clientIp(asRequest({ "x-forwarded-for": "9.9.9.9, 203.0.113.7" })),
    "203.0.113.7",
    "the leftmost entry is whatever the caller sent, so it buys a fresh bucket per request",
  );
});

test("a single forwarded entry is the address", () => {
  assert.equal(clientIp(asRequest({ "x-forwarded-for": " 203.0.113.7 " })), "203.0.113.7");
});

test("the platform header is used when nothing was forwarded", () => {
  assert.equal(clientIp(asRequest({ "x-real-ip": "203.0.113.7" })), "203.0.113.7");
  assert.equal(clientIp(asRequest({ "x-forwarded-for": "", "x-real-ip": "203.0.113.7" })), "203.0.113.7");
});

test("an unidentifiable caller shares one bucket rather than escaping the limiter", () => {
  assert.equal(clientIp(asRequest({})), "unknown");
});

// ── the ceiling ─────────────────────────────────────────────────────────────

test("the first max calls are allowed and the next one is refused", () => {
  const limited = createLimiter({ windowMs: WINDOW, max: 3 });
  assert.deepEqual(
    [limited("k"), limited("k"), limited("k"), limited("k")],
    [false, false, false, true],
    "max is a ceiling on allowed calls, not on refused ones",
  );
});

test("a zero max refuses even the first call", () => {
  const limited = createLimiter({ windowMs: WINDOW, max: 0 });
  assert.equal(limited("k"), true);
});

test("a key stays refused for every further call inside the window", () => {
  const limited = createLimiter({ windowMs: WINDOW, max: 1 });
  limited("k");
  assert.deepEqual([limited("k"), limited("k"), limited("k")], [true, true, true]);
});

// ── the window edge ─────────────────────────────────────────────────────────

test("a hit one tick before the window closes still counts against the ceiling", (t) => {
  mock.timers.enable({ apis: ["Date"], now: 0 });
  t.after(() => mock.timers.reset());
  const limited = createLimiter({ windowMs: WINDOW, max: 1 });

  assert.equal(limited("k"), false);
  mock.timers.tick(WINDOW - 1);
  assert.equal(limited("k"), true, "the earlier hit has not yet left the window");
});

test("a hit exactly windowMs old has left the window", (t) => {
  mock.timers.enable({ apis: ["Date"], now: 0 });
  t.after(() => mock.timers.reset());
  const limited = createLimiter({ windowMs: WINDOW, max: 1 });

  assert.equal(limited("k"), false);
  mock.timers.tick(WINDOW);
  assert.equal(limited("k"), false, "the window is exclusive at its far edge");
});

test("the window slides rather than resetting on a fixed schedule", (t) => {
  mock.timers.enable({ apis: ["Date"], now: 0 });
  t.after(() => mock.timers.reset());
  const limited = createLimiter({ windowMs: WINDOW, max: 2 });

  limited("k"); // t=0
  mock.timers.tick(WINDOW / 2);
  limited("k"); // t=30s — at the ceiling now
  mock.timers.tick(WINDOW / 2); // t=60s: the t=0 hit expires, the t=30s one does not

  assert.equal(limited("k"), false, "one slot freed, so one call gets through");
  assert.equal(limited("k"), true, "and only one — the t=30s hit is still counted");
});

// ── keys ────────────────────────────────────────────────────────────────────

test("exhausting one key does not limit another", () => {
  const limited = createLimiter({ windowMs: WINDOW, max: 1 });
  limited("noisy");
  assert.equal(limited("noisy"), true);
  assert.equal(limited("quiet"), false, "one abuser must not lock out everyone else");
});

test("the tracked-key map is bounded, and passing the bound clears every counter", () => {
  const limited = createLimiter({ windowMs: WINDOW, max: 1, maxKeys: 2 });

  limited("a");
  assert.equal(limited("a"), true, "a is over its ceiling");
  limited("b"); // two keys tracked — still within the bound
  assert.equal(limited("a"), true, "still over it while nothing has been evicted");

  limited("c"); // third key passes maxKeys and clears the map wholesale
  assert.equal(
    limited("a"),
    false,
    "eviction is wholesale: bounded memory is bought with reset counters",
  );
});

test("a limiter with a one-key bound still refuses within a single call burst", () => {
  const limited = createLimiter({ windowMs: WINDOW, max: 1, maxKeys: 1 });
  assert.equal(limited("a"), false);
  assert.equal(limited("a"), true, "the map never exceeds its bound, so nothing is cleared");
});
