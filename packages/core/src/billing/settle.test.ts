import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileDb } from "../db/file.ts";
import { grantForOrder } from "./settle.ts";
import { REFERRAL_REWARD_DAYS } from "./referral.ts";

const db = async () => createFileDb(await mkdtemp(join(tmpdir(), "vnt-settle-")));
const email = (() => { let n = 0; return () => `test-albert+settle${++n}@example.com`; })();

test("grantForOrder grants the buyer's tier and settles idempotently", async () => {
  const d = await db();
  const buyer = await d.users.upsertByEmail(email());
  const id = "vnt-o1";
  await d.orders.create({ id, email: buyer.email, tier: "pro", plan: "monthly", amount: 199000, provider: "momo" }, new Date());

  assert.equal(await grantForOrder(d, (await d.orders.get(id))!, "txn-1", new Date()), "granted");
  assert.equal((await d.users.findByEmail(buyer.email))?.tier, "pro");
  assert.equal(await grantForOrder(d, (await d.orders.get(id))!, "txn-1", new Date()), "already", "replay grants nothing new");
});

test("a referred buyer's first purchase credits the referrer a free month, once", async () => {
  const d = await db();
  const referrer = await d.users.upsertByEmail(email());
  const buyer = await d.users.upsertByEmail(email());
  await d.users.setReferredBy(buyer.email, referrer.referralCode);

  const now = new Date();
  await d.orders.create({ id: "vnt-r1", email: buyer.email, tier: "plus", plan: "monthly", amount: 99000, provider: "momo" }, now);
  await grantForOrder(d, (await d.orders.get("vnt-r1"))!, "txn", now);

  const credited = await d.users.findByEmail(referrer.email);
  assert.equal(credited?.tier, "plus", "referrer is upgraded");
  const days = (credited!.tierExpiresAt!.getTime() - now.getTime()) / 86_400_000;
  assert.ok(Math.abs(days - REFERRAL_REWARD_DAYS) < 1, `~${REFERRAL_REWARD_DAYS} days credited`);
  assert.ok((await d.users.findByEmail(buyer.email))?.referralRewardedAt, "buyer marked rewarded");

  // A second purchase must not credit the referrer again.
  await d.orders.create({ id: "vnt-r2", email: buyer.email, tier: "plus", plan: "monthly", amount: 99000, provider: "momo" }, now);
  await grantForOrder(d, (await d.orders.get("vnt-r2"))!, "txn2", now);
  const after = await d.users.findByEmail(referrer.email);
  const days2 = (after!.tierExpiresAt!.getTime() - now.getTime()) / 86_400_000;
  assert.ok(Math.abs(days2 - REFERRAL_REWARD_DAYS) < 1, "no second credit");
});
