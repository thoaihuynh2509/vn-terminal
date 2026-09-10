import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileDb } from "../db/file.ts";
import { ABANDON_AFTER_MS, abandonCutoff, expireAbandonedOrders } from "./expire.ts";

const db = async () => createFileDb(await mkdtemp(join(tmpdir(), "vnt-expire-")));
const email = (() => { let n = 0; return () => `test-albert+expire${++n}@example.com`; })();

const NOW = new Date("2026-09-08T12:00:00.000Z");
const ago = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000);

test("an order is abandoned once it has gone unpaid for a day", () => {
  assert.equal(abandonCutoff(NOW).toISOString(), "2026-09-07T12:00:00.000Z");
});

test("the sweep fails a pending order older than the cutoff and counts it", async () => {
  const d = await db();
  const buyer = await d.users.upsertByEmail(email());
  await d.orders.create({ id: "vnt-e1", email: buyer.email, tier: "plus", plan: "monthly", amount: 99000, provider: "momo" }, ago(30));

  assert.equal(await expireAbandonedOrders(d, NOW), 1);
  assert.equal((await d.orders.get("vnt-e1"))?.status, "failed");
});

test("the sweep leaves an order the buyer may still be paying", async () => {
  const d = await db();
  const buyer = await d.users.upsertByEmail(email());
  await d.orders.create({ id: "vnt-e2", email: buyer.email, tier: "plus", plan: "monthly", amount: 99000, provider: "momo" }, ago(2));

  assert.equal(await expireAbandonedOrders(d, NOW), 0);
  assert.equal((await d.orders.get("vnt-e2"))?.status, "pending");
});

test("the sweep never touches an order that was paid", async () => {
  const d = await db();
  const buyer = await d.users.upsertByEmail(email());
  await d.orders.create({ id: "vnt-e3", email: buyer.email, tier: "pro", plan: "annual", amount: 1990000, provider: "momo" }, ago(400));
  await d.orders.markPaid("vnt-e3", "txn", ago(399));

  assert.equal(await expireAbandonedOrders(d, NOW), 0, "an old paid order is history, not an abandonment");
  assert.equal((await d.orders.get("vnt-e3"))?.status, "paid");
});

test("an order one minute short of a day is still the buyer's to pay", async () => {
  const d = await db();
  const buyer = await d.users.upsertByEmail(email());
  await d.orders.create({ id: "vnt-e4", email: buyer.email, tier: "plus", plan: "monthly", amount: 99000, provider: "momo" }, ago(23.99));

  assert.equal(await expireAbandonedOrders(d, NOW), 0);
});

test("an order created exactly a day ago is not yet abandoned", async () => {
  const d = await db();
  const buyer = await d.users.upsertByEmail(email());
  await d.orders.create({ id: "vnt-e5", email: buyer.email, tier: "plus", plan: "monthly", amount: 99000, provider: "momo" }, abandonCutoff(NOW));

  assert.equal(await expireAbandonedOrders(d, NOW), 0, "the cutoff is strictly older-than");
});

test("running the sweep twice in one day expires each order once", async () => {
  const d = await db();
  const buyer = await d.users.upsertByEmail(email());
  await d.orders.create({ id: "vnt-e6", email: buyer.email, tier: "plus", plan: "monthly", amount: 99000, provider: "momo" }, ago(30));

  assert.equal(await expireAbandonedOrders(d, NOW), 1);
  assert.equal(await expireAbandonedOrders(d, NOW), 0, "a retried cron is not a second abandonment");
});

test("the sweep reports every abandoned order it found, not just the first", async () => {
  const d = await db();
  const buyer = await d.users.upsertByEmail(email());
  for (const id of ["vnt-e7", "vnt-e8", "vnt-e9"]) {
    await d.orders.create({ id, email: buyer.email, tier: "plus", plan: "monthly", amount: 99000, provider: "momo" }, ago(30));
  }
  assert.equal(await expireAbandonedOrders(d, NOW), 3);
});

test("a sweep of a table with nothing to expire is not an error", async () => {
  const d = await db();
  assert.equal(await expireAbandonedOrders(d, NOW), 0);
});

test("an order the owner already took back is not swept up again", async () => {
  const d = await db();
  const buyer = await d.users.upsertByEmail(email());
  await d.orders.create({ id: "vnt-e10", email: buyer.email, tier: "pro", plan: "monthly", amount: 199000, provider: "momo" }, ago(400));
  await d.orders.markPaid("vnt-e10", "txn", ago(399));
  await d.orders.markRevoked("vnt-e10", ago(300));

  assert.equal(await expireAbandonedOrders(d, NOW), 0);
  assert.equal((await d.orders.get("vnt-e10"))?.status, "revoked", "a revoke is final, not a stage before failed");
});

test("the abandonment window can be shortened without touching the sweep", async () => {
  const d = await db();
  const buyer = await d.users.upsertByEmail(email());
  await d.orders.create({ id: "vnt-e11", email: buyer.email, tier: "plus", plan: "monthly", amount: 99000, provider: "momo" }, ago(2));

  assert.equal(abandonCutoff(NOW, 3_600_000).toISOString(), "2026-09-08T11:00:00.000Z");
  assert.equal(await d.orders.expirePending(abandonCutoff(NOW, 3_600_000)), 1);
});

test("the default window is a day", () => {
  assert.equal(ABANDON_AFTER_MS, 86_400_000);
});
