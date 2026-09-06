import assert from "node:assert/strict";
import test from "node:test";
import { adminEmails, isAdmin } from "./admin.ts";

function withEnv<T>(v: string | undefined, fn: () => T): T {
  const saved = process.env.ADMIN_EMAILS;
  try {
    if (v === undefined) delete process.env.ADMIN_EMAILS;
    else process.env.ADMIN_EMAILS = v;
    return fn();
  } finally {
    if (saved === undefined) delete process.env.ADMIN_EMAILS;
    else process.env.ADMIN_EMAILS = saved;
  }
}

test("no allowlist means nobody is an admin", () => {
  withEnv(undefined, () => {
    assert.equal(isAdmin("test-albert@example.com"), false);
    assert.deepEqual(adminEmails(), []);
  });
});

test("membership is case-insensitive and trims spaces", () => {
  withEnv(" Owner@Example.com , second@example.com ", () => {
    assert.equal(isAdmin("owner@example.com"), true);
    assert.equal(isAdmin("OWNER@EXAMPLE.COM"), true);
    assert.equal(isAdmin("second@example.com"), true);
    assert.equal(isAdmin("stranger@example.com"), false);
    assert.equal(isAdmin(null), false);
    assert.equal(isAdmin(undefined), false);
  });
});
