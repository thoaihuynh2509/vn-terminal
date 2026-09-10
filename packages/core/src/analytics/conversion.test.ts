import assert from "node:assert/strict";
import test from "node:test";
import { purchaseCompletedEvent, purchaseRevokedEvent, signupCompletedEvent } from "./conversion.ts";
import { personId } from "./server.ts";

const order = {
  id: "vnt-o9",
  email: "Test-Albert@Example.com",
  tier: "pro" as const,
  plan: "annual" as const,
  amount: 1990000,
  status: "paid" as const,
  provider: "momo",
  providerRef: "txn-9",
  createdAt: new Date("2026-09-05T10:00:00.000Z"),
  paidAt: new Date("2026-09-05T10:01:00.000Z"),
};

test("signup_completed identifies the new account without naming it", () => {
  const e = signupCompletedEvent("Test-Albert@Example.com");
  assert.equal(e.name, "signup_completed");
  assert.equal(e.distinctId, personId("Test-Albert@Example.com"));
});

test("purchase_completed carries the revenue PostHog needs to report it", () => {
  const e = purchaseCompletedEvent(order);
  assert.equal(e.name, "purchase_completed");
  assert.equal(e.properties.amount, 1990000);
  assert.equal(e.properties.currency, "VND");
});

test("purchase_completed names the tier, plan, rail and order it came from", () => {
  const e = purchaseCompletedEvent(order);
  assert.equal(e.properties.tier, "pro");
  assert.equal(e.properties.plan, "annual");
  assert.equal(e.properties.provider, "momo");
  assert.equal(e.properties.order_id, "vnt-o9");
});

test("a purchase is attributed to a person id, never to the raw email", () => {
  const e = purchaseCompletedEvent(order);
  assert.equal(e.distinctId, personId(order.email));
  assert.notEqual(e.distinctId, order.email);
  assert.ok(!JSON.stringify(e).includes("@"), "no address may reach the analytics vendor");
});

test("a revoked purchase negates the revenue it originally reported", () => {
  const e = purchaseRevokedEvent({ ...order, status: "revoked" as const });
  assert.equal(e.name, "purchase_revoked");
  assert.equal(e.properties.amount, -1990000, "a refund is negative revenue, not a second sale");
  assert.equal(e.properties.currency, "VND");
});

test("a signup reports no properties at all, so no address can ride along", () => {
  const e = signupCompletedEvent("Test-Albert@Example.com");
  assert.deepEqual(e.properties, {});
});

test("a signup and a purchase by the same reader are one person", () => {
  assert.equal(signupCompletedEvent(order.email).distinctId, purchaseCompletedEvent(order).distinctId);
});

test("a revoke reports the same person, tier, plan and order as the purchase", () => {
  const bought = purchaseCompletedEvent(order);
  const back = purchaseRevokedEvent({ ...order, status: "revoked" as const });
  assert.equal(back.distinctId, bought.distinctId);
  assert.deepEqual(
    { tier: back.properties.tier, plan: back.properties.plan, order_id: back.properties.order_id, provider: back.properties.provider },
    { tier: bought.properties.tier, plan: bought.properties.plan, order_id: bought.properties.order_id, provider: bought.properties.provider },
  );
});

test("a monthly purchase reports its own amount, not the annual one", () => {
  const e = purchaseCompletedEvent({ ...order, tier: "plus" as const, plan: "monthly" as const, amount: 99000 });
  assert.equal(e.properties.amount, 99000);
  assert.equal(e.properties.plan, "monthly");
});

test("the reported amount is whatever the order was actually charged", () => {
  // Not re-derived from the price table: a legacy order keeps the price it sold
  // at, so a price change cannot rewrite history in the revenue report.
  const e = purchaseCompletedEvent({ ...order, amount: 1234567 });
  assert.equal(e.properties.amount, 1234567);
});
