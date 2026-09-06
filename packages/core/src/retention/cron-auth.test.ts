import assert from "node:assert/strict";
import test from "node:test";
import { cronAuthorized } from "./cron-auth.ts";

const req = (auth?: string) =>
  new Request("https://x.test/api/cron/alerts", auth ? { headers: { authorization: auth } } : undefined);

function withSecret<T>(value: string | undefined, fn: () => T): T {
  const saved = process.env.CRON_SECRET;
  try {
    if (value === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = value;
    return fn();
  } finally {
    if (saved === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = saved;
  }
}

test("no secret configured is 'not_configured', never open", () => {
  assert.equal(withSecret(undefined, () => cronAuthorized(req("Bearer anything"))), "not_configured");
});

test("a matching bearer is authorized; anything else is rejected", () => {
  withSecret("s3cret", () => {
    assert.equal(cronAuthorized(req("Bearer s3cret")), "ok");
    assert.equal(cronAuthorized(req("Bearer wrong")), "unauthorized");
    assert.equal(cronAuthorized(req()), "unauthorized");
    assert.equal(cronAuthorized(req("s3cret")), "unauthorized", "must be a Bearer token");
  });
});
