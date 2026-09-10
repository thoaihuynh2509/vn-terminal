import assert from "node:assert/strict";
import test from "node:test";
import { captureBody, identifyBody, posthogConfig } from "./posthog.ts";

function withEnv<T>(vars: Record<string, string | undefined>, fn: () => T): T {
  const keys = ["NEXT_PUBLIC_POSTHOG_KEY", "NEXT_PUBLIC_POSTHOG_HOST"];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  try {
    for (const k of keys) delete process.env[k];
    for (const [k, v] of Object.entries(vars)) if (v !== undefined) process.env[k] = v;
    return fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

test("captureBody produces the exact PostHog capture shape", () => {
  const b = captureBody("phc_key", "checkout_started", "id-1", { tier: "pro", plan: "annual" }, Date.UTC(2026, 0, 1));
  assert.equal(b.api_key, "phc_key");
  assert.equal(b.event, "checkout_started");
  assert.equal(b.distinct_id, "id-1");
  assert.equal(b.timestamp, "2026-01-01T00:00:00.000Z");
  assert.deepEqual(b.properties, { tier: "pro", plan: "annual", $lib: "vnt-web" });
});

test("no key means analytics is disabled (fail-closed no-op)", () => {
  assert.equal(withEnv({}, posthogConfig), null);
});

test("a key enables it and host defaults to the US cloud", () => {
  assert.deepEqual(withEnv({ NEXT_PUBLIC_POSTHOG_KEY: "phc_x" }, posthogConfig), {
    apiKey: "phc_x",
    host: "https://us.i.posthog.com",
  });
  assert.equal(withEnv({ NEXT_PUBLIC_POSTHOG_KEY: "phc_x", NEXT_PUBLIC_POSTHOG_HOST: "https://eu.i.posthog.com" }, posthogConfig)?.host, "https://eu.i.posthog.com");
});

test("the $lib tag can be overridden so a server event is not counted as web", () => {
  const b = captureBody("phc_key", "purchase_completed", "id-1", { tier: "pro" }, Date.UTC(2026, 0, 1), "vnt-server");
  assert.deepEqual(b.properties, { tier: "pro", $lib: "vnt-server" });
});

// ── `$identify` payload (A3) ───────────────────────────────────────────────

test("identifyBody merges the anonymous browser id into the identified person", () => {
  const b = identifyBody("phc_key", "person-1", "anon-9", { tier: "pro" }, Date.UTC(2026, 0, 1));
  assert.equal(b.event, "$identify");
  assert.equal(b.distinct_id, "person-1");
  assert.deepEqual(b.properties, { $anon_distinct_id: "anon-9", $set: { tier: "pro" }, $lib: "vnt-web" });
});

test("an identify carries the api key and the instant it happened", () => {
  const b = identifyBody("phc_key", "person-1", "anon-9", { tier: "pro" }, Date.UTC(2026, 0, 1));
  assert.equal(b.api_key, "phc_key");
  assert.equal(b.timestamp, "2026-01-01T00:00:00.000Z");
});

test("with no anonymous id to merge, the identify carries properties only", () => {
  // PostHog rejects an $identify whose two ids are the same, so the signed-out
  // path and every repeat call must omit the merge rather than fake one.
  const b = identifyBody("phc_key", "anon-9", null, { tier: "free" }, Date.UTC(2026, 0, 1));
  assert.deepEqual(b.properties, { $set: { tier: "free" }, $lib: "vnt-web" });
  assert.equal(b.distinct_id, "anon-9");
});
