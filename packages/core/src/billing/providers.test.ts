import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPayUrl,
  isPaid as vnpayPaid,
  signData,
  verifyReturn,
  vnpDate,
  type VnpayConfig,
} from "./vnpay.ts";
import { authorizeWebhook, matchesOrder, qrImageUrl, type SepayConfig } from "./sepay.ts";
import { isProvider, PROVIDER_KIND } from "./providers.ts";

// ── VNPay ────────────────────────────────────────────────────────────────────
const vnp: VnpayConfig = { tmnCode: "TEST01", secret: "SECRETKEY123456", payUrl: "https://sandbox.vnpayment.vn/paymentv2/vpcpay.html" };

test("VNPay signData is alphabetical and excludes the hash fields", () => {
  const data = signData({ vnp_TmnCode: "TEST01", vnp_Amount: 9900000, vnp_SecureHash: "x", vnp_SecureHashType: "SHA512" });
  assert.equal(data, "vnp_Amount=9900000&vnp_TmnCode=TEST01");
});

test("a VNPay pay URL verifies against its own secure hash; a tampered amount fails", () => {
  const url = buildPayUrl(vnp, {
    amount: 99000,
    txnRef: "vnt-1",
    orderInfo: "VN Terminal plus",
    returnUrl: "https://x.test/return",
    ipAddr: "127.0.0.1",
    createDate: "20260101000000",
  });
  const u = new URL(url);
  const params = Object.fromEntries(u.searchParams.entries());
  assert.equal(params.vnp_Amount, "9900000", "VND × 100");
  assert.ok(verifyReturn(vnp, params), "the URL we built must verify");

  params.vnp_Amount = "1"; // tamper
  assert.ok(!verifyReturn(vnp, params), "a changed amount must break the hash");
});

test("VNPay success needs both response and transaction status 00", () => {
  assert.ok(vnpayPaid({ vnp_ResponseCode: "00", vnp_TransactionStatus: "00" }));
  assert.ok(!vnpayPaid({ vnp_ResponseCode: "00", vnp_TransactionStatus: "02" }));
  assert.ok(!vnpayPaid({ vnp_ResponseCode: "24", vnp_TransactionStatus: "00" }));
});

test("vnpDate is 14 digits in GMT+7", () => {
  assert.match(vnpDate(new Date("2026-01-01T00:00:00Z")), /^\d{14}$/);
  assert.equal(vnpDate(new Date("2026-01-01T00:00:00Z")).slice(0, 8), "20260101"); // +7h same day
});

// ── SePay ──────────────────────────────────────────────────────────────────
const sepay: SepayConfig = { apiKey: "k3y", bank: "MB", account: "0123456789" };

test("SePay webhook auth is an exact Apikey header", () => {
  assert.ok(authorizeWebhook(sepay, "Apikey k3y"));
  assert.ok(!authorizeWebhook(sepay, "Apikey wrong"));
  assert.ok(!authorizeWebhook(sepay, "Bearer k3y"));
  assert.ok(!authorizeWebhook(sepay, null));
});

test("SePay QR encodes the order id as the transfer memo", () => {
  const url = qrImageUrl(sepay, "vnt-abc", 99000);
  const u = new URL(url);
  assert.equal(u.searchParams.get("des"), "vnt-abc");
  assert.equal(u.searchParams.get("amount"), "99000");
  assert.equal(u.searchParams.get("acc"), "0123456789");
});

test("a transfer settles an order only when the memo carries the id and the amount covers it", () => {
  const order = { id: "vnt-abc", amount: 99000 };
  assert.ok(matchesOrder({ content: "chuyen khoan VNT-ABC", transferAmount: 99000, transferType: "in" }, order));
  assert.ok(matchesOrder({ content: "VNT-ABC", transferAmount: 100000 }, order), "overpay still settles");
  assert.ok(!matchesOrder({ content: "VNT-ABC", transferAmount: 98000 }, order), "underpay does not");
  assert.ok(!matchesOrder({ content: "wrong memo", transferAmount: 99000 }, order));
  assert.ok(!matchesOrder({ content: "VNT-ABC", transferAmount: 99000, transferType: "out" }, order), "outgoing ignored");
});

// ── registry ─────────────────────────────────────────────────────────────────
test("provider guard and kinds", () => {
  assert.ok(isProvider("momo") && isProvider("vnpay") && isProvider("sepay"));
  assert.ok(!isProvider("paypal") && !isProvider(""));
  assert.equal(PROVIDER_KIND.momo, "redirect");
  assert.equal(PROVIDER_KIND.sepay, "qr");
});
