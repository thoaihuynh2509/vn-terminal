/**
 * The one place a paid order becomes an entitlement.
 *
 * Every provider callback (MoMo IPN, VNPay return, SePay webhook) verifies its
 * own signature and amount, then calls this. The `markPaid` transition is the
 * idempotency lock — a replayed callback finds the order already paid and grants
 * nothing — so this is safe to call more than once. Centralised so that a new
 * effect on payment (referral credit) is added in exactly one spot.
 */
import type { Db, OrderRecord, UserRecord } from "../db/index.ts";
import { expiryFrom, priceFor } from "./plans.ts";
import { REFERRAL_REWARD_DAYS } from "./referral.ts";
import { captureServer, WEBHOOK_CAPTURE_MS } from "../analytics/server.ts";
import { purchaseCompletedEvent, purchaseRevokedEvent } from "../analytics/conversion.ts";

export type SettleResult = "granted" | "already";
export type RevokeResult = "revoked" | "already";

/**
 * What happens BESIDES the money once an order settles or is taken back.
 *
 * Injected rather than imported at the call site so the settle path can be
 * tested with no PostHog key and no network, and so a new effect is added in
 * one place. Every effect runs after the database writes and inside its own
 * try/catch: telemetry never decides whether a reader keeps what they paid for.
 */
export interface SettleEffects {
  onGranted(order: OrderRecord): Promise<void>;
  onRevoked(order: OrderRecord): Promise<void>;
}

/**
 * The real effects: conversion analytics.
 *
 * Awaited, not fired and forgotten — Vercel freezes un-awaited work once the
 * response is sent, so a detached capture is a capture that may never happen —
 * but bounded inside `captureServer`, which never rejects and gives up quickly.
 * Every caller of this is a provider webhook or the owner's admin confirm, so
 * it takes the webhook budget; nothing here is on a path a reader waits on.
 */
export const analyticsEffects: SettleEffects = {
  onGranted: async (order) => { await captureServer(purchaseCompletedEvent(order), { timeoutMs: WEBHOOK_CAPTURE_MS }); },
  onRevoked: async (order) => { await captureServer(purchaseRevokedEvent(order), { timeoutMs: WEBHOOK_CAPTURE_MS }); },
};

export async function grantForOrder(
  db: Db,
  order: OrderRecord,
  providerRef: string,
  now: Date,
  effects: SettleEffects = analyticsEffects,
): Promise<SettleResult> {
  const claimed = await db.orders.markPaid(order.id, providerRef, now);
  if (!claimed) return "already"; // replay: someone already settled this order
  const entitled = await db.users.grant(claimed.email, claimed.tier, expiryFrom(now, claimed.plan, claimed.tier));
  // The status flip and the entitlement write are separate round-trips with no
  // transaction around them, so an owner revoke can complete in the gap and
  // leave the ledger saying 'revoked' while the buyer keeps a live paid tier —
  // silently, with nothing in the admin view showing it. Re-read and undo.
  if ((await db.orders.get(claimed.id))?.status === "revoked") {
    await undoGrant(db, claimed, entitled, now);
    return "already"; // the sale did not stand: no referral credit, no conversion
  }
  await creditReferrer(db, claimed, now);
  // After creditReferrer, so the referral path this used to end at is unchanged
  // and a thrown effect cannot cost a credit that was already earned.
  try {
    await effects.onGranted(claimed);
  } catch {
    /* a dead analytics vendor cannot fail a payment */
  }
  return "granted";
}

/**
 * The settle path run backwards: the owner confirmed an order that never
 * actually paid, or refunded one by hand.
 *
 * `markRevoked` is the idempotency lock exactly as `markPaid` is on the way in,
 * so a double-click retracts one term and no more. The referrer's free month is
 * NOT clawed back and the buyer stays marked rewarded: the referral was earned
 * by referring, and un-marking it would let a re-purchase pay a second time.
 */
export async function revokeForOrder(
  db: Db,
  order: OrderRecord,
  now: Date,
  effects: SettleEffects = analyticsEffects,
): Promise<RevokeResult> {
  const revoked = await db.orders.markRevoked(order.id, now);
  if (!revoked) return "already"; // never paid, or already taken back
  await db.users.retract(revoked.email, revoked.tier, priceFor(revoked.tier, revoked.plan).days, now);
  try {
    await effects.onRevoked(revoked);
  } catch {
    /* the refund stands whether or not it was reported */
  }
  return "revoked";
}

/**
 * Take back a term granted for an order the owner revoked in the same instant.
 *
 * Only when the revoke has NOT already retracted it. Which of the two ran first
 * is unknowable without a transaction, so the term we just wrote is the marker:
 * an end date still exactly where the grant left it means nothing has taken it
 * back yet. Retracting unconditionally would eat a month the reader is holding
 * on a DIFFERENT order, which is worse than the state it set out to repair.
 */
async function undoGrant(db: Db, order: OrderRecord, entitled: UserRecord | null, now: Date): Promise<void> {
  if (!entitled) return; // nothing was granted, so there is nothing to take back
  const held = await db.users.findByEmail(order.email);
  if (held?.tierExpiresAt?.getTime() !== entitled.tierExpiresAt?.getTime()) return;
  await db.users.retract(order.email, order.tier, priceFor(order.tier, order.plan).days, now);
}

/**
 * A referred reader's FIRST paid order credits their referrer a free month.
 * Guarded by `referralRewardedAt` so it pays once, and self-referral is
 * impossible because a referrer is only ever another account's email.
 */
async function creditReferrer(db: Db, order: OrderRecord, now: Date): Promise<void> {
  const buyer = await db.users.findByEmail(order.email);
  if (!buyer?.referredBy || buyer.referralRewardedAt) return;
  const referrer = await db.users.findByReferralCode(buyer.referredBy);
  if (!referrer) return;
  await db.users.grant(referrer.email, "plus", new Date(now.getTime() + REFERRAL_REWARD_DAYS * 86_400_000));
  await db.users.markReferralRewarded(order.email, now);
}
