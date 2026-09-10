/**
 * Abandoned checkouts.
 *
 * Payment is a static bank/MoMo QR with no gateway, so nothing ever tells us a
 * reader walked away — an order the buyer abandoned sits `pending` forever and
 * inflates the pending count the owner reconciles against. A daily sweep fails
 * anything older than a day. `failed` is not final: `markPaid` still claims it,
 * so a transfer that lands late is still honoured.
 */
import type { Db } from "../db/index.ts";

/** How long an unpaid order is left claimable before the sweep gives up on it. */
export const ABANDON_AFTER_MS = 24 * 60 * 60_000;

export function abandonCutoff(now: Date, ttlMs: number = ABANDON_AFTER_MS): Date {
  return new Date(now.getTime() - ttlMs);
}

/** Fails every pending order older than the cutoff; returns how many. */
export function expireAbandonedOrders(db: Db, now: Date): Promise<number> {
  return db.orders.expirePending(abandonCutoff(now));
}
