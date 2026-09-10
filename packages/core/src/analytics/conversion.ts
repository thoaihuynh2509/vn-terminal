/**
 * The three conversions worth counting: an account created, a purchase settled,
 * and a purchase taken back.
 *
 * Pure builders, so the payload a payment path sends is testable without a
 * PostHog key and without a network. Every one is attributed to `personId`, so
 * no reader's address reaches the vendor.
 */
import type { OrderRecord } from "../db/types.ts";
import { personId, type ServerEvent } from "./server.ts";

/** What a conversion needs off an order — narrower than the stored row. */
type PurchaseOrder = Pick<OrderRecord, "id" | "email" | "tier" | "plan" | "amount" | "provider" | "status">;

const purchaseProps = (order: PurchaseOrder, amount: number) => ({
  amount,
  currency: "VND",
  tier: order.tier,
  plan: order.plan,
  provider: order.provider,
  order_id: order.id,
});

export function signupCompletedEvent(email: string): ServerEvent {
  return { name: "signup_completed", distinctId: personId(email), properties: {} };
}

export function purchaseCompletedEvent(order: PurchaseOrder): ServerEvent {
  return {
    name: "purchase_completed",
    distinctId: personId(order.email),
    properties: purchaseProps(order, order.amount),
  };
}

/** Negative revenue, so a refunded month leaves the revenue report, not adds to it. */
export function purchaseRevokedEvent(order: PurchaseOrder): ServerEvent {
  return {
    name: "purchase_revoked",
    distinctId: personId(order.email),
    properties: purchaseProps(order, -order.amount),
  };
}
