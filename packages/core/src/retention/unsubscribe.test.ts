import assert from "node:assert/strict";
import test from "node:test";
import { unsubToken, verifyUnsub } from "./unsubscribe.ts";

function withSecret<T>(v: string | undefined, fn: () => T): T {
  const saved = process.env.AUTH_SECRET;
  try {
    if (v === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = v;
    return fn();
  } finally {
    if (saved === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = saved;
  }
}

const SECRET = "a".repeat(40);

test("a token verifies for its own address, is case-insensitive, and fails for another", () => {
  withSecret(SECRET, () => {
    const t = unsubToken("Test-Albert@Example.com")!;
    assert.ok(verifyUnsub("test-albert@example.com", t), "same address, normalised");
    assert.ok(!verifyUnsub("someone-else@example.com", t), "must not unsubscribe a different address");
    assert.ok(!verifyUnsub("test-albert@example.com", "deadbeef"), "a wrong token fails");
    assert.ok(!verifyUnsub("test-albert@example.com", null), "no token fails");
  });
});
