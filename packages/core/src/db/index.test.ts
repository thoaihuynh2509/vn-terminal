/**
 * Driver selection.
 *
 * The invariant under test is the degradation rule: a deployment with no
 * database configured must resolve to "none" and let callers answer 501, never
 * pick a driver it cannot run or throw on import.
 *
 * Every case saves and restores the variables it touches, so no test can leak
 * an environment into the next one.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { activeDbDriver, dbAvailable, getDb, DbUnavailableError } from "./index.ts";

const KEYS = ["DATABASE_URL", "DB_DRIVER", "NODE_ENV"] as const;

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

// A syntactically valid URL that is never connected to — nothing here calls getDb
// down the postgres path, which would load the client and open a pool.
const URL_ = "postgres://test-albert:pw@127.0.0.1:5432/test_vnt";

test("a configured DATABASE_URL selects postgres", async () => {
  assert.equal(await withEnv({ DATABASE_URL: URL_ }, activeDbDriver), "postgres");
});

test("DATABASE_URL wins over both NODE_ENV and DB_DRIVER", async () => {
  assert.equal(
    await withEnv({ DATABASE_URL: URL_, DB_DRIVER: "file", NODE_ENV: "production" }, activeDbDriver),
    "postgres",
    "a real database is never shadowed by a dev override",
  );
});

test("an empty DATABASE_URL does not count as configured", async () => {
  assert.equal(
    await withEnv({ DATABASE_URL: "", NODE_ENV: "production" }, activeDbDriver),
    "none",
    "`DATABASE_URL=` in an env file must not select a driver with no address",
  );
});

test("outside production an unconfigured deployment uses the file driver", async () => {
  assert.equal(await withEnv({ NODE_ENV: "development" }, activeDbDriver), "file");
});

test("an absent NODE_ENV is not production", async () => {
  assert.equal(await withEnv({}, activeDbDriver), "file");
});

test("in production with nothing configured there is no driver", async () => {
  assert.equal(
    await withEnv({ NODE_ENV: "production" }, activeDbDriver),
    "none",
    "production must never silently fall back to a filesystem store",
  );
});

test("DB_DRIVER=file opts a production deployment into the file driver", async () => {
  assert.equal(await withEnv({ NODE_ENV: "production", DB_DRIVER: "file" }, activeDbDriver), "file");
});

test("an unrecognised DB_DRIVER is not an opt-in", async () => {
  assert.equal(await withEnv({ NODE_ENV: "production", DB_DRIVER: "sqlite" }, activeDbDriver), "none");
});

test("dbAvailable is false only when there is no driver", async () => {
  assert.equal(await withEnv({ NODE_ENV: "production" }, dbAvailable), false);
  assert.equal(await withEnv({ NODE_ENV: "development" }, dbAvailable), true);
  assert.equal(await withEnv({ DATABASE_URL: URL_ }, dbAvailable), true);
});

test("getDb refuses with DbUnavailableError rather than a generic throw", async () => {
  await withEnv({ NODE_ENV: "production" }, async () => {
    // Routes branch on this type to answer 501 instead of 500.
    await assert.rejects(getDb(), DbUnavailableError);
  });
});
