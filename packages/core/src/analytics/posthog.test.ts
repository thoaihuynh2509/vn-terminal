import assert from "node:assert/strict";
import test from "node:test";
import { captureBody, posthogConfig } from "./posthog.ts";

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
