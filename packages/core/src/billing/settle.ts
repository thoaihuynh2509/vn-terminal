/**
 * The one place a paid order becomes an entitlement.
 *
 * Every provider callback (MoMo IPN, VNPay return, SePay webhook) verifies its
 * own signature and amount, then calls this. The `markPaid` transition is the
 * idempotency lock — a replayed callback finds the order already paid and grants
 * nothing — so this is safe to call more than once. Centralised so that a new
 * effect on payment (referral credit) is added in exactly one spot.
 */
import type { Db, OrderRecord } from "../db/index.ts";
import { expiryFrom } from "./plans.ts";
import { REFERRAL_REWARD_DAYS } from "./referral.ts";

export type SettleResult = "granted" | "already";

export async function grantForOrder(
  db: Db,
  order: OrderRecord,
  providerRef: string,
  now: Date,
): Promise<SettleResult> {
  const claimed = await db.orders.markPaid(order.id, providerRef, now);
  if (!claimed) return "already"; // replay: someone already settled this order
  await db.users.grant(claimed.email, claimed.tier, expiryFrom(now, claimed.plan, claimed.tier));
  await creditReferrer(db, claimed, now);
  return "granted";
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
