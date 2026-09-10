/**
 * Admin revoke — the settle path run backwards (A6).
 *
 * Its own file rather than more of settle.test.ts: taking a term back has more
 * cases than granting one (stacked months, an annual, a reader already free, a
 * race with the IPN), and its fixtures grant before they revoke.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileDb } from "../db/file.ts";
import type { Db, OrderRecord } from "../db/types.ts";
import { grantForOrder, revokeForOrder, type SettleEffects } from "./settle.ts";
import { REFERRAL_REWARD_DAYS } from "./referral.ts";

const db = async () => createFileDb(await mkdtemp(join(tmpdir(), "vnt-revoke-")));
const email = (() => { let n = 0; return () => `test-albert+revoke${++n}@example.com`; })();

const spy = () => {
  const revoked: OrderRecord[] = [];
  const effects: SettleEffects = {
    onGranted: async () => {},
    onRevoked: async (order) => { revoked.push(order); },
  };
  return { effects, revoked };
};

test("revokeForOrder revokes the order and drops the buyer to free", async () => {
  const d = await db();
  const buyer = await d.users.upsertByEmail(email());
  await d.orders.create({ id: "vnt-rv1", email: buyer.email, tier: "pro", plan: "monthly", amount: 199000, provider: "momo" }, new Date());
  await grantForOrder(d, (await d.orders.get("vnt-rv1"))!, "txn", new Date());

  const { effects } = spy();
  assert.equal(await revokeForOrder(d, (await d.orders.get("vnt-rv1"))!, new Date(), effects), "revoked");
  assert.equal((await d.orders.get("vnt-rv1"))?.status, "revoked");
  assert.equal((await d.users.findByEmail(buyer.email))?.tier, "free");
});

test("a second revoke of the same order changes nothing", async () => {
  const d = await db();
  const buyer = await d.users.upsertByEmail(email());
  await d.orders.create({ id: "vnt-rv2", email: buyer.email, tier: "pro", plan: "monthly", amount: 199000, provider: "momo" }, new Date());
  await grantForOrder(d, (await d.orders.get("vnt-rv2"))!, "txn", new Date());
  const { effects } = spy();
  await revokeForOrder(d, (await d.orders.get("vnt-rv2"))!, new Date(), effects);

  assert.equal(await revokeForOrder(d, (await d.orders.get("vnt-rv2"))!, new Date(), effects), "already");
});

test("onRevoked fires exactly once across a revoke and its replay", async () => {
  const d = await db();
  const buyer = await d.users.upsertByEmail(email());
  await d.orders.create({ id: "vnt-rv3", email: buyer.email, tier: "plus", plan: "monthly", amount: 99000, provider: "momo" }, new Date());
  await grantForOrder(d, (await d.orders.get("vnt-rv3"))!, "txn", new Date());
  const { effects, revoked } = spy();

  await revokeForOrder(d, (await d.orders.get("vnt-rv3"))!, new Date(), effects);
  await revokeForOrder(d, (await d.orders.get("vnt-rv3"))!, new Date(), effects);

  assert.equal(revoked.length, 1, "one refund is one negated purchase, not two");
});

test("revoking an order that was never paid takes nothing away", async () => {
  const d = await db();
  const buyer = await d.users.upsertByEmail(email());
  await d.users.grant(buyer.email, "pro", new Date(Date.now() + 30 * 86_400_000));
  await d.orders.create({ id: "vnt-rv4", email: buyer.email, tier: "pro", plan: "monthly", amount: 199000, provider: "momo" }, new Date());
  const { effects, revoked } = spy();

  assert.equal(await revokeForOrder(d, (await d.orders.get("vnt-rv4"))!, new Date(), effects), "already");
  assert.equal((await d.orders.get("vnt-rv4"))?.status, "pending", "a pending order is not a refund");
  assert.equal((await d.users.findByEmail(buyer.email))?.tier, "pro", "an unrelated entitlement is untouched");
  assert.equal(revoked.length, 0);
});

test("a revoked order can never be granted again by a replayed IPN", async () => {
  const d = await db();
  const buyer = await d.users.upsertByEmail(email());
  await d.orders.create({ id: "vnt-rv5", email: buyer.email, tier: "pro", plan: "monthly", amount: 199000, provider: "momo" }, new Date());
  await grantForOrder(d, (await d.orders.get("vnt-rv5"))!, "txn", new Date());
  await revokeForOrder(d, (await d.orders.get("vnt-rv5"))!, new Date());

  assert.equal(await grantForOrder(d, (await d.orders.get("vnt-rv5"))!, "txn", new Date()), "already");
  assert.equal((await d.users.findByEmail(buyer.email))?.tier, "free", "the refunded reader stays free");
});

test("a revoke does not claw back the referrer's free month", async () => {
  // The referrer earned the credit by referring, not by the buyer keeping the
  // order; and the buyer stays marked rewarded so a re-purchase cannot pay twice.
  const d = await db();
  const referrer = await d.users.upsertByEmail(email());
  const buyer = await d.users.upsertByEmail(email());
  await d.users.setReferredBy(buyer.email, referrer.referralCode);
  const now = new Date();
  await d.orders.create({ id: "vnt-rv6", email: buyer.email, tier: "plus", plan: "monthly", amount: 99000, provider: "momo" }, now);
  await grantForOrder(d, (await d.orders.get("vnt-rv6"))!, "txn", now);

  await revokeForOrder(d, (await d.orders.get("vnt-rv6"))!, now);

  const credited = await d.users.findByEmail(referrer.email);
  assert.equal(credited?.tier, "plus", "the referrer keeps the month they earned");
  const days = (credited!.tierExpiresAt!.getTime() - now.getTime()) / 86_400_000;
  assert.ok(Math.abs(days - REFERRAL_REWARD_DAYS) < 1, `~${REFERRAL_REWARD_DAYS} days survive the revoke`);
  assert.ok((await d.users.findByEmail(buyer.email))?.referralRewardedAt, "the buyer stays marked rewarded");
});

test("a revoke of an already-free reader still marks the order and stays idempotent", async () => {
  // The owner may have downgraded the account by hand first. There is nothing
  // left to take back, but the ledger must still record that the sale is off.
  const d = await db();
  const buyer = await d.users.upsertByEmail(email());
  await d.orders.create({ id: "vnt-rv7", email: buyer.email, tier: "pro", plan: "monthly", amount: 199000, provider: "momo" }, new Date());
  await grantForOrder(d, (await d.orders.get("vnt-rv7"))!, "txn", new Date());
  await d.users.setTier(buyer.email, "free");

  assert.equal(await revokeForOrder(d, (await d.orders.get("vnt-rv7"))!, new Date()), "revoked");
  assert.equal((await d.orders.get("vnt-rv7"))?.status, "revoked");
  assert.equal((await d.users.findByEmail(buyer.email))?.tier, "free");
  assert.equal(await revokeForOrder(d, (await d.orders.get("vnt-rv7"))!, new Date()), "already");
});

test("revoking one of two stacked months leaves the reader paid up for the other", async () => {
  const d = await db();
  const buyer = await d.users.upsertByEmail(email());
  const now = new Date();
  for (const id of ["vnt-rv8a", "vnt-rv8b"]) {
    await d.orders.create({ id, email: buyer.email, tier: "plus", plan: "monthly", amount: 99000, provider: "momo" }, now);
    await grantForOrder(d, (await d.orders.get(id))!, `txn-${id}`, now);
  }

  await revokeForOrder(d, (await d.orders.get("vnt-rv8b"))!, now);

  const after = await d.users.findByEmail(buyer.email);
  assert.equal(after?.tier, "plus", "the month they still hold is still theirs");
  const daysLeft = (after!.tierExpiresAt!.getTime() - now.getTime()) / 86_400_000;
  assert.ok(Math.abs(daysLeft - 30) < 1, `~30 days remain, got ${daysLeft}`);
});

test("revoking both months leaves the reader free", async () => {
  const d = await db();
  const buyer = await d.users.upsertByEmail(email());
  const now = new Date();
  for (const id of ["vnt-rv9a", "vnt-rv9b"]) {
    await d.orders.create({ id, email: buyer.email, tier: "plus", plan: "monthly", amount: 99000, provider: "momo" }, now);
    await grantForOrder(d, (await d.orders.get(id))!, `txn-${id}`, now);
  }

  await revokeForOrder(d, (await d.orders.get("vnt-rv9a"))!, now);
  await revokeForOrder(d, (await d.orders.get("vnt-rv9b"))!, new Date(Date.now() + 60_000));

  const after = await d.users.findByEmail(buyer.email);
  assert.equal(after?.tier, "free");
  assert.equal(after?.tierExpiresAt, null);
});

test("revoking an annual order takes back the whole year, not a month", async () => {
  const d = await db();
  const buyer = await d.users.upsertByEmail(email());
  await d.orders.create({ id: "vnt-rv10", email: buyer.email, tier: "pro", plan: "annual", amount: 1990000, provider: "momo" }, new Date());
  await grantForOrder(d, (await d.orders.get("vnt-rv10"))!, "txn", new Date());

  await revokeForOrder(d, (await d.orders.get("vnt-rv10"))!, new Date(Date.now() + 60_000));
  assert.equal((await d.users.findByEmail(buyer.email))?.tier, "free");
});

test("a revoke reports the taken-back row, revoked and timestamped", async () => {
  const d = await db();
  const buyer = await d.users.upsertByEmail(email());
  await d.orders.create({ id: "vnt-rv11", email: buyer.email, tier: "pro", plan: "monthly", amount: 199000, provider: "momo" }, new Date());
  await grantForOrder(d, (await d.orders.get("vnt-rv11"))!, "txn", new Date());
  const { effects, revoked } = spy();

  const at = new Date("2026-09-08T12:00:00.000Z");
  await revokeForOrder(d, (await d.orders.get("vnt-rv11"))!, at, effects);

  assert.equal(revoked[0]?.status, "revoked", "the effect sees the row as it now stands");
  assert.deepEqual(revoked[0]?.revokedAt, at);
});

test("a revoke stands even when reporting it throws", async () => {
  const d = await db();
  const buyer = await d.users.upsertByEmail(email());
  await d.orders.create({ id: "vnt-rv12", email: buyer.email, tier: "pro", plan: "monthly", amount: 199000, provider: "momo" }, new Date());
  await grantForOrder(d, (await d.orders.get("vnt-rv12"))!, "txn", new Date());
  let calls = 0;
  const effects: SettleEffects = {
    onGranted: async () => {},
    onRevoked: async () => { calls++; throw new Error("posthog is down"); },
  };

  const result = await revokeForOrder(d, (await d.orders.get("vnt-rv12"))!, new Date(Date.now() + 60_000), effects);

  assert.equal(calls, 1, "the effect must actually run, or this proves nothing");
  assert.equal(result, "revoked");
  assert.equal((await d.users.findByEmail(buyer.email))?.tier, "free");
});

test("a revoked order swept by the expiry job is not resurrected as claimable", async () => {
  const d = await db();
  const buyer = await d.users.upsertByEmail(email());
  await d.orders.create({ id: "vnt-rv13", email: buyer.email, tier: "pro", plan: "monthly", amount: 199000, provider: "momo" }, new Date());
  await grantForOrder(d, (await d.orders.get("vnt-rv13"))!, "txn", new Date());
  await revokeForOrder(d, (await d.orders.get("vnt-rv13"))!, new Date());

  await d.orders.expirePending(new Date(Date.now() + 86_400_000));
  assert.equal(await grantForOrder(d, (await d.orders.get("vnt-rv13"))!, "txn-replay", new Date()), "already");
  assert.equal((await d.users.findByEmail(buyer.email))?.tier, "free");
});

test("a revoke that completes mid-grant does not leave a revoked order paid up", async () => {
  // The status flip and the entitlement write are two round-trips with no
  // transaction between them. Driving the owner's revoke through the gap is the
  // only way to observe the window from a test.
  const d = await db();
  const buyer = await d.users.upsertByEmail(email());
  await d.orders.create({ id: "vnt-rv14", email: buyer.email, tier: "pro", plan: "monthly", amount: 199000, provider: "momo" }, new Date());
  const { effects } = spy();
  const racing: Db = {
    ...d,
    users: {
      ...d.users,
      grant: async (e, t, exp) => {
        await revokeForOrder(d, (await d.orders.get("vnt-rv14"))!, new Date(), effects);
        return d.users.grant(e, t, exp);
      },
    },
  };

  const result = await grantForOrder(racing, (await d.orders.get("vnt-rv14"))!, "txn", new Date(), effects);

  assert.equal(result, "already", "a sale the owner took back did not settle");
  assert.equal((await d.orders.get("vnt-rv14"))?.status, "revoked");
  assert.equal((await d.users.findByEmail(buyer.email))?.tier, "free", "the ledger and the entitlement must agree");
});

test("a purchase revoked mid-grant is never reported as a conversion", async () => {
  const d = await db();
  const buyer = await d.users.upsertByEmail(email());
  await d.orders.create({ id: "vnt-rv15", email: buyer.email, tier: "plus", plan: "monthly", amount: 99000, provider: "momo" }, new Date());
  const granted: OrderRecord[] = [];
  const effects: SettleEffects = {
    onGranted: async (order) => { granted.push(order); },
    onRevoked: async () => {},
  };
  const racing: Db = {
    ...d,
    users: {
      ...d.users,
      grant: async (e, t, exp) => {
        await revokeForOrder(d, (await d.orders.get("vnt-rv15"))!, new Date(), effects);
        return d.users.grant(e, t, exp);
      },
    },
  };

  await grantForOrder(racing, (await d.orders.get("vnt-rv15"))!, "txn", new Date(), effects);

  assert.equal(granted.length, 0, "revenue must not be reported for a sale that did not stand");
});

test("a referrer is not credited for a purchase revoked mid-grant", async () => {
  const d = await db();
  const referrer = await d.users.upsertByEmail(email());
  const buyer = await d.users.upsertByEmail(email());
  await d.users.setReferredBy(buyer.email, referrer.referralCode);
  await d.orders.create({ id: "vnt-rv16", email: buyer.email, tier: "plus", plan: "monthly", amount: 99000, provider: "momo" }, new Date());
  const { effects } = spy();
  const racing: Db = {
    ...d,
    users: {
      ...d.users,
      grant: async (e, t, exp) => {
        // Only the buyer's grant races; the referrer credit runs after the check.
        if (e === buyer.email) await revokeForOrder(d, (await d.orders.get("vnt-rv16"))!, new Date(), effects);
        return d.users.grant(e, t, exp);
      },
    },
  };

  await grantForOrder(racing, (await d.orders.get("vnt-rv16"))!, "txn", new Date(), effects);

  assert.equal((await d.users.findByEmail(referrer.email))?.tier, "free", "no free month for a sale that was taken back");
  assert.equal((await d.users.findByEmail(buyer.email))?.referralRewardedAt, null, "the buyer can still earn it on a real purchase");
});

test("a revoke completing after the grant does not eat a month held on another order", async () => {
  // The mirror ordering of the test above, and the reason the undo is guarded:
  // the revoke has already retracted the term by the time the grant re-reads,
  // so taking it back a second time would come out of an unrelated purchase.
  const d = await db();
  const buyer = await d.users.upsertByEmail(email());
  const now = new Date();
  for (const id of ["vnt-rv17a", "vnt-rv17b"]) {
    await d.orders.create({ id, email: buyer.email, tier: "plus", plan: "monthly", amount: 99000, provider: "momo" }, now);
  }
  const { effects } = spy();
  await grantForOrder(d, (await d.orders.get("vnt-rv17a"))!, "txn-a", now, effects);

  const racing: Db = {
    ...d,
    orders: {
      ...d.orders,
      get: async (id) => {
        // The owner's revoke lands between the entitlement write and the re-read.
        if (id === "vnt-rv17b" && (await d.orders.get(id))?.status === "paid") {
          await revokeForOrder(d, (await d.orders.get(id))!, new Date(), effects);
        }
        return d.orders.get(id);
      },
    },
  };
  await grantForOrder(racing, (await d.orders.get("vnt-rv17b"))!, "txn-b", now, effects);

  const after = await d.users.findByEmail(buyer.email);
  assert.equal((await d.orders.get("vnt-rv17b"))?.status, "revoked");
  assert.equal(after?.tier, "plus", "the month bought on the other order is still theirs");
  const daysLeft = (after!.tierExpiresAt!.getTime() - now.getTime()) / 86_400_000;
  assert.ok(Math.abs(daysLeft - 30) < 1, `~30 days remain, got ${daysLeft}`);
});
