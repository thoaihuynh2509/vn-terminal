/**
 * VNPay pay-with-redirect: build the signed pay URL and verify the return/IPN.
 *
 * VNPay signs the exact query string it is sent, so the rule that keeps an
 * integration correct is: sign what you send and verify what you received,
 * byte for byte. We build the URL-encoded, alphabetically-sorted param string
 * once, HMAC-SHA512 it, and both send and re-derive from that same string.
 * Amount is VND × 100 (VNPay's smallest unit), an integer.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export interface VnpayConfig {
  tmnCode: string;
  secret: string;
  payUrl: string; // gateway base, e.g. sandbox vnpayment...vpcpay.html
}

const SANDBOX = "https://sandbox.vnpayment.vn/paymentv2/vpcpay.html";

export function vnpayConfig(): VnpayConfig | null {
  const tmnCode = process.env.VNPAY_TMN_CODE;
  const secret = process.env.VNPAY_HASH_SECRET;
  if (!tmnCode || !secret) return null;
  return { tmnCode, secret, payUrl: process.env.VNPAY_PAY_URL || SANDBOX };
}

/** VNPay's space-as-plus form encoding, applied per value. */
function enc(v: string | number): string {
  return encodeURIComponent(String(v)).replace(/%20/g, "+");
}

/** Sorted `key=enc(value)&...` over the vnp_ params — the exact string signed. */
export function signData(params: Record<string, string | number>): string {
  return Object.keys(params)
    .filter((k) => k !== "vnp_SecureHash" && k !== "vnp_SecureHashType")
    .sort()
    .map((k) => `${k}=${enc(params[k])}`)
    .join("&");
}

function hmac(raw: string, secret: string): string {
  return createHmac("sha512", secret).update(raw, "utf8").digest("hex");
}

export interface VnpayCreate {
  amount: number; // whole VND
  txnRef: string; // our order id
  orderInfo: string;
  returnUrl: string;
  ipAddr: string;
  createDate: string; // yyyyMMddHHmmss
}

/** The full redirect URL a reader is sent to. */
export function buildPayUrl(c: VnpayConfig, p: VnpayCreate): string {
  const params: Record<string, string | number> = {
    vnp_Version: "2.1.0",
    vnp_Command: "pay",
    vnp_TmnCode: c.tmnCode,
    vnp_Amount: p.amount * 100,
    vnp_CurrCode: "VND",
    vnp_TxnRef: p.txnRef,
    vnp_OrderInfo: p.orderInfo,
    vnp_OrderType: "other",
    vnp_Locale: "vn",
    vnp_ReturnUrl: p.returnUrl,
    vnp_IpAddr: p.ipAddr,
    vnp_CreateDate: p.createDate,
  };
  const data = signData(params);
  const hash = hmac(data, c.secret);
  return `${c.payUrl}?${data}&vnp_SecureHash=${hash}`;
}

/** Constant-time check of a return/IPN param set against its secure hash. */
export function verifyReturn(c: VnpayConfig, params: Record<string, string>): boolean {
  const provided = params.vnp_SecureHash ?? "";
  const expected = hmac(signData(params), c.secret);
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(provided, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** VNPay success is response AND transaction status both "00". */
export function isPaid(params: Record<string, string>): boolean {
  return params.vnp_ResponseCode === "00" && params.vnp_TransactionStatus === "00";
}

/** yyyyMMddHHmmss in GMT+7 (VNPay's expected timezone). */
export function vnpDate(now: Date): string {
  const t = new Date(now.getTime() + 7 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${t.getUTCFullYear()}${p(t.getUTCMonth() + 1)}${p(t.getUTCDate())}` +
    `${p(t.getUTCHours())}${p(t.getUTCMinutes())}${p(t.getUTCSeconds())}`
  );
}
