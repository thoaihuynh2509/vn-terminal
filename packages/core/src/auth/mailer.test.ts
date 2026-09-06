/**
 * Magic-link delivery.
 *
 * The link is a bearer credential, so the tests here are about where it goes
 * and what happens when the configured channel cannot carry it. The network is
 * stubbed throughout — a mailer test that can reach the internet is a mailer
 * test that can mail a stranger.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { TestContext } from "node:test";
import { activeMailDriver, mailAvailable, sendMagicLink } from "./mailer.ts";

const KEYS = ["MAIL_PROVIDER", "RESEND_API_KEY", "MAIL_FROM", "NODE_ENV"] as const;

async function withEnv<T>(vars: Record<string, string | undefined>, fn: () => T | Promise<T>): Promise<T> {
  const saved = new Map<string, string | undefined>(KEYS.map((k) => [k, process.env[k]]));
  try {
    for (const k of KEYS) delete process.env[k];
    for (const [k, v] of Object.entries(vars)) if (v !== undefined) process.env[k] = v;
    return await fn();
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const LINK = "https://vnt.example.com/vi/dang-nhap/verify?token=test-token";
const message = { to: "test-albert@example.com", url: LINK, locale: "vi" } as const;

/** Both stubs are restored by the runner when the test ends. */
function stubIO(t: TestContext) {
  const log = t.mock.method(console, "log", () => {});
  const fetch = t.mock.method(globalThis, "fetch", () => Promise.resolve(new Response(null, { status: 200 })));
  return { log, fetch };
}

// ── driver selection ────────────────────────────────────────────────────────

test("delivery defaults to the console so a fresh checkout can sign in", async () => {
  assert.equal(await withEnv({}, activeMailDriver), "console");
});

test("resend is selected only by its exact name", async () => {
  assert.equal(await withEnv({ MAIL_PROVIDER: "resend" }, activeMailDriver), "resend");
  assert.equal(await withEnv({ MAIL_PROVIDER: "Resend" }, activeMailDriver), "console");
  assert.equal(await withEnv({ MAIL_PROVIDER: "sendgrid" }, activeMailDriver), "console");
});

// ── the production refusal ──────────────────────────────────────────────────

test("in production the console driver is never the default", async () => {
  const prod = { NODE_ENV: "production" };
  assert.equal(
    await withEnv(prod, activeMailDriver),
    "none",
    "an unset MAIL_PROVIDER must not print sign-in tokens into the production log",
  );
  assert.equal(await withEnv({ ...prod, MAIL_PROVIDER: "sendgrid" }, activeMailDriver), "none");
  assert.equal(await withEnv({ ...prod, MAIL_PROVIDER: "Console" }, activeMailDriver), "none");
});

test("in production the console driver has to be named", async () => {
  assert.equal(
    await withEnv({ NODE_ENV: "production", MAIL_PROVIDER: "console" }, activeMailDriver),
    "console",
    "an operator who writes it down still gets it — the route suite needs a readable link",
  );
});

test("resend is unaffected by the production refusal", async () => {
  assert.equal(await withEnv({ NODE_ENV: "production", MAIL_PROVIDER: "resend" }, activeMailDriver), "resend");
});

test("mailAvailable reports exactly the deployments that can carry a link", async () => {
  assert.equal(await withEnv({ NODE_ENV: "production" }, mailAvailable), false);
  assert.equal(await withEnv({ NODE_ENV: "production", MAIL_PROVIDER: "resend" }, mailAvailable), true);
  assert.equal(await withEnv({}, mailAvailable), true, "local work still signs in with no vendor");
});

test("a driverless deployment refuses the send instead of logging the link", async (t) => {
  const io = stubIO(t);

  await assert.rejects(
    withEnv({ NODE_ENV: "production" }, () => sendMagicLink(message)),
    /MAIL_PROVIDER/,
  );
  assert.equal(io.log.mock.callCount(), 0, "the link must not reach the log");
  assert.equal(io.fetch.mock.callCount(), 0);
});

// ── console driver ──────────────────────────────────────────────────────────

test("the console driver reports the link locally and sends nothing", async (t) => {
  const io = stubIO(t);

  await withEnv({}, () => sendMagicLink(message));

  assert.equal(io.fetch.mock.callCount(), 0, "the default driver must not reach the network");
  assert.equal(io.log.mock.callCount(), 1);
});

test("the console driver returns nothing, so no caller can echo the link", async (t) => {
  stubIO(t);
  assert.equal(await withEnv({}, () => sendMagicLink(message)), undefined);
});

// ── resend driver ───────────────────────────────────────────────────────────

test("resend without an API key fails loudly instead of silently dropping the link", async (t) => {
  const io = stubIO(t);

  await assert.rejects(
    withEnv({ MAIL_PROVIDER: "resend" }, () => sendMagicLink(message)),
    /RESEND_API_KEY/,
  );
  assert.equal(io.fetch.mock.callCount(), 0, "a misconfigured mailer must not call out at all");
});

test("resend addresses only the requested recipient and carries the link in the body", async (t) => {
  const io = stubIO(t);

  await withEnv({ MAIL_PROVIDER: "resend", RESEND_API_KEY: "test-key" }, () => sendMagicLink(message));

  assert.equal(io.fetch.mock.callCount(), 1);
  const [, init] = io.fetch.mock.calls[0].arguments;
  const body: unknown = JSON.parse(String(init?.body));
  assert.ok(body !== null && typeof body === "object");
  const sent = body as { to: string[]; text: string };
  assert.deepEqual(sent.to, ["test-albert@example.com"], "exactly one recipient");
  assert.ok(sent.text.includes(LINK));
});

test("a rejected send surfaces the provider status rather than resolving", async (t) => {
  t.mock.method(console, "log", () => {});
  t.mock.method(globalThis, "fetch", () => Promise.resolve(new Response(null, { status: 422 })));

  await assert.rejects(
    withEnv({ MAIL_PROVIDER: "resend", RESEND_API_KEY: "test-key" }, () => sendMagicLink(message)),
    /422/,
  );
});
