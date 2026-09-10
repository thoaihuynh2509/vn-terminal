import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileDb } from "../db/file.ts";
import type { OrderRecord } from "../db/types.ts";
import { grantForOrder, type SettleEffects } from "./settle.ts";
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

// ── conversion telemetry at the settle seam (A1/A2/A4) ─────────────────────
//
// The effect is injected rather than imported so the test observes the exact
// call the analytics rail would make, with no network and no PostHog key.

const spy = () => {
  const granted: OrderRecord[] = [];
  const revoked: OrderRecord[] = [];
  const effects: SettleEffects = {
    onGranted: async (order) => { granted.push(order); },
    onRevoked: async (order) => { revoked.push(order); },
  };
  return { effects, granted, revoked };
};

test("onGranted fires exactly once across a grant and its replay", async () => {
  const d = await db();
  const buyer = await d.users.upsertByEmail(email());
  await d.orders.create({ id: "vnt-fx1", email: buyer.email, tier: "pro", plan: "monthly", amount: 199000, provider: "momo" }, new Date());
  const { effects, granted } = spy();

  await grantForOrder(d, (await d.orders.get("vnt-fx1"))!, "txn-1", new Date(), effects);
  await grantForOrder(d, (await d.orders.get("vnt-fx1"))!, "txn-1", new Date(), effects);

  assert.equal(granted.length, 1, "a replayed IPN must not double-count the purchase");
});

test("the order handed to onGranted is the PAID row, carrying its VND amount", async () => {
  const d = await db();
  const buyer = await d.users.upsertByEmail(email());
  await d.orders.create({ id: "vnt-fx2", email: buyer.email, tier: "pro", plan: "annual", amount: 1990000, provider: "momo" }, new Date());
  const { effects, granted } = spy();

  await grantForOrder(d, (await d.orders.get("vnt-fx2"))!, "txn-2", new Date(), effects);

  assert.equal(granted[0]?.status, "paid");
  assert.equal(granted[0]?.amount, 1990000, "revenue is the order amount in whole VND");
});

test("every payment rail reports the purchase with its own provider", async () => {
  const d = await db();
  const buyer = await d.users.upsertByEmail(email());
  const { effects, granted } = spy();

  for (const provider of ["momo", "vnpay", "sepay", "manual"]) {
    const id = `vnt-rail-${provider}`;
    await d.orders.create({ id, email: buyer.email, tier: "plus", plan: "monthly", amount: 99000, provider }, new Date());
    await grantForOrder(d, (await d.orders.get(id))!, `txn-${provider}`, new Date(), effects);
  }

  assert.deepEqual(granted.map((o) => o.provider), ["momo", "vnpay", "sepay", "manual"]);
});

test("a grant survives an effect that ran and threw", async () => {
  const d = await db();
  const buyer = await d.users.upsertByEmail(email());
  await d.orders.create({ id: "vnt-fx3", email: buyer.email, tier: "pro", plan: "monthly", amount: 199000, provider: "momo" }, new Date());
  let calls = 0;
  const effects: SettleEffects = {
    onGranted: async () => { calls++; throw new Error("posthog is down"); },
    onRevoked: async () => {},
  };

  const result = await grantForOrder(d, (await d.orders.get("vnt-fx3"))!, "txn-3", new Date(), effects);

  assert.equal(calls, 1, "the effect must actually run, or this proves nothing");
  assert.equal(result, "granted", "a dead analytics vendor cannot fail a payment");
  assert.equal((await d.users.findByEmail(buyer.email))?.tier, "pro", "the buyer keeps what they paid for");
});

test("the default effects run for real, and an unconfigured vendor is a no-op", async () => {
  // Exercises analyticsEffects and captureServer end to end with no key: the
  // path production takes when PostHog is not wired must not reach the network.
  const saved = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
  try {
    const d = await db();
    const buyer = await d.users.upsertByEmail(email());
    await d.orders.create({ id: "vnt-fx4", email: buyer.email, tier: "plus", plan: "monthly", amount: 99000, provider: "momo" }, new Date());

    assert.equal(await grantForOrder(d, (await d.orders.get("vnt-fx4"))!, "txn-4", new Date()), "granted");
    assert.equal((await d.users.findByEmail(buyer.email))?.tier, "plus");
  } finally {
    if (saved === undefined) delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
    else process.env.NEXT_PUBLIC_POSTHOG_KEY = saved;
  }
});

test("the referrer is already credited by the time the purchase is reported", async () => {
  // Ordering matters: an effect that threw before creditReferrer ran would cost
  // a referrer the month they earned.
  const d = await db();
  const referrer = await d.users.upsertByEmail(email());
  const buyer = await d.users.upsertByEmail(email());
  await d.users.setReferredBy(buyer.email, referrer.referralCode);
  await d.orders.create({ id: "vnt-fx5", email: buyer.email, tier: "plus", plan: "monthly", amount: 99000, provider: "momo" }, new Date());

  let tierWhenReported: string | undefined;
  const effects: SettleEffects = {
    onGranted: async () => { tierWhenReported = (await d.users.findByEmail(referrer.email))?.tier; },
    onRevoked: async () => {},
  };
  await grantForOrder(d, (await d.orders.get("vnt-fx5"))!, "txn-5", new Date(), effects);

  assert.equal(tierWhenReported, "plus");
});

test("a replayed IPN reports nothing even when the first grant's effect threw", async () => {
  const d = await db();
  const buyer = await d.users.upsertByEmail(email());
  await d.orders.create({ id: "vnt-fx6", email: buyer.email, tier: "pro", plan: "monthly", amount: 199000, provider: "momo" }, new Date());
  let calls = 0;
  const effects: SettleEffects = {
    onGranted: async () => { calls++; throw new Error("posthog is down"); },
    onRevoked: async () => {},
  };

  await grantForOrder(d, (await d.orders.get("vnt-fx6"))!, "txn-6", new Date(), effects);
  await grantForOrder(d, (await d.orders.get("vnt-fx6"))!, "txn-6", new Date(), effects);

  assert.equal(calls, 1, "a failed report is not retried by a replay, and not doubled either");
});

test("an order the sweep failed is reported once when the money finally lands", async () => {
  const d = await db();
  const buyer = await d.users.upsertByEmail(email());
  await d.orders.create({ id: "vnt-fx7", email: buyer.email, tier: "plus", plan: "monthly", amount: 99000, provider: "momo" }, new Date(Date.now() - 2 * 86_400_000));
  await d.orders.expirePending(new Date(Date.now() - 86_400_000));
  const { effects, granted } = spy();

  assert.equal(await grantForOrder(d, (await d.orders.get("vnt-fx7"))!, "txn-7", new Date(), effects), "granted");
  assert.equal(granted.length, 1, "a late transfer is still a sale");
  assert.equal((await d.users.findByEmail(buyer.email))?.tier, "plus");
});
