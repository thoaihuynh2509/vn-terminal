import assert from "node:assert/strict";
import test from "node:test";
import { captureServer, personId, type ServerTransport } from "./server.ts";
import type { PosthogConfig } from "./posthog.ts";

const cfg: PosthogConfig = { apiKey: "phc_server", host: "https://eu.i.posthog.com" };

const event = {
  name: "purchase_completed",
  distinctId: "person-1",
  properties: { amount: 199000, currency: "VND" },
};

/** Records what the rail tried to send, so nothing leaves the process. */
const recorder = () => {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const transport: ServerTransport = async (url, body) => { calls.push({ url, body }); };
  return { transport, calls };
};

test("an unconfigured server sends nothing and reports the event unsent", async () => {
  const { transport, calls } = recorder();
  assert.equal(await captureServer(event, { config: null, transport, timeoutMs: 500 }), false);
  assert.equal(calls.length, 0, "no key means no request, not a request to nowhere");
});

test("a configured capture posts the PostHog capture shape to the ingest path", async () => {
  const { transport, calls } = recorder();
  await captureServer(event, { config: cfg, transport, timeoutMs: 500, nowMs: Date.UTC(2026, 0, 1) });

  assert.equal(calls[0]?.url, "https://eu.i.posthog.com/i/v0/e/");
  assert.deepEqual(calls[0]?.body, {
    api_key: "phc_server",
    event: "purchase_completed",
    distinct_id: "person-1",
    properties: { amount: 199000, currency: "VND", $lib: "vnt-server" },
    timestamp: "2026-01-01T00:00:00.000Z",
  });
});

test("a transport that rejects is swallowed and reported as unsent", async () => {
  const transport: ServerTransport = async () => { throw new Error("ECONNREFUSED"); };
  assert.equal(await captureServer(event, { config: cfg, transport, timeoutMs: 500 }), false);
});

test("a transport that never answers gives up at the timeout instead of hanging", async () => {
  // A payment callback must return to the provider on its own schedule; a
  // wedged analytics socket cannot be allowed to hold the IPN open.
  const transport: ServerTransport = () => new Promise<void>(() => {});
  assert.equal(await captureServer(event, { config: cfg, transport, timeoutMs: 20 }), false);
});

test("personId is stable and case-insensitive for one address", () => {
  assert.equal(personId("Test-Albert@Example.com"), personId("test-albert@example.com"));
  assert.equal(personId("test-albert@example.com"), personId("test-albert@example.com"));
  assert.notEqual(personId("test-albert@example.com"), personId("test-other@example.com"));
});

test("personId never carries the address it identifies", () => {
  const id = personId("test-albert@example.com");
  assert.ok(!id.includes("@"), id);
  assert.ok(!id.includes("test-albert"), "an analytics vendor gets an id, not a mailing list");
  assert.ok(!id.includes("example.com"));
});

test("a transport that answers after the deadline is still given up on", async () => {
  const transport: ServerTransport = () => new Promise<void>((resolve) => setTimeout(resolve, 200));
  assert.equal(await captureServer(event, { config: cfg, transport, timeoutMs: 10 }), false);
});

test("a transport that answers in time reports the event sent", async () => {
  const { transport } = recorder();
  assert.equal(await captureServer(event, { config: cfg, transport, timeoutMs: 500 }), true);
});

test("the capture is given a signal so a wedged socket is actually aborted", async () => {
  let signal: AbortSignal | undefined;
  const transport: ServerTransport = async (_url, _body, s) => { signal = s; };
  await captureServer(event, { config: cfg, transport, timeoutMs: 500 });
  assert.ok(signal, "the transport must be able to cancel its own request");
});

test("a host written with a trailing slash still addresses the ingest path", () => {
  // NEXT_PUBLIC_POSTHOG_HOST is hand-typed by an operator, and a doubled slash
  // is a different path: every server-side conversion would silently go nowhere.
  const { transport, calls } = recorder();
  return captureServer(event, { config: { apiKey: "k", host: "https://eu.i.posthog.com/" }, transport, timeoutMs: 500 })
    .then(() => assert.equal(calls[0]?.url, "https://eu.i.posthog.com/i/v0/e/"));
});

test("with no config given at all the environment decides, and here it is off", async () => {
  const saved = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
  try {
    const { transport, calls } = recorder();
    assert.equal(await captureServer(event, { transport, timeoutMs: 500 }), false);
    assert.equal(calls.length, 0);
  } finally {
    if (saved === undefined) delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
    else process.env.NEXT_PUBLIC_POSTHOG_KEY = saved;
  }
});

test("personId returns the same id however many times it is asked", () => {
  const id = personId("test-albert@example.com");
  for (let i = 0; i < 5; i++) assert.equal(personId("test-albert@example.com"), id);
});

test("personId ignores the whitespace a pasted address arrives with", () => {
  assert.equal(personId("  test-albert@example.com  "), personId("test-albert@example.com"));
});

test("personId is a sha-256 digest, so its length leaks nothing about the address", () => {
  assert.match(personId("a@b.co"), /^[0-9a-f]{64}$/);
  assert.equal(personId("a-very-long-address-indeed@example.com").length, personId("a@b.co").length);
});
