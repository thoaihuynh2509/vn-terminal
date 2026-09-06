/**
 * MoMo AIO (All-in-One) one-time payment: signing and verification.
 *
 * The signing is pure and lives here so it is unit-testable without a network
 * or real credentials; the route does the actual `fetch`. Amounts are whole
 * VND. Signatures are hex HMAC-SHA256 of a field string whose key order is
 * FIXED BY MoMo's spec — not alphabetical of whatever we happen to send, but
 * the exact list below. Getting the order wrong is the most common integration
 * bug and fails only at MoMo, so it is pinned by a test vector.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export interface MomoConfig {
  partnerCode: string;
  accessKey: string;
  secretKey: string;
  endpoint: string; // full create URL
}

const SANDBOX = "https://test-payment.momo.vn/v2/gateway/api/create";

/** Env-only. Null when not fully configured — checkout then answers 501. */
export function momoConfig(): MomoConfig | null {
  const partnerCode = process.env.MOMO_PARTNER_CODE;
  const accessKey = process.env.MOMO_ACCESS_KEY;
  const secretKey = process.env.MOMO_SECRET_KEY;
  if (!partnerCode || !accessKey || !secretKey) return null;
  return { partnerCode, accessKey, secretKey, endpoint: process.env.MOMO_ENDPOINT || SANDBOX };
}

export function billingEnabled(): boolean {
  return momoConfig() !== null;
}

function hmac(raw: string, secretKey: string): string {
  return createHmac("sha256", secretKey).update(raw, "utf8").digest("hex");
}

export interface CreateParams {
  amount: number;
  orderId: string;
  requestId: string;
  orderInfo: string;
  redirectUrl: string;
  ipnUrl: string;
  extraData?: string; // base64 or empty
  requestType?: string;
}

/** The exact field string MoMo signs for a create request. */
export function createRawSignature(c: MomoConfig, p: CreateParams): string {
  const extraData = p.extraData ?? "";
  const requestType = p.requestType ?? "captureWallet";
  return (
    `accessKey=${c.accessKey}` +
    `&amount=${p.amount}` +
    `&extraData=${extraData}` +
    `&ipnUrl=${p.ipnUrl}` +
    `&orderId=${p.orderId}` +
    `&orderInfo=${p.orderInfo}` +
    `&partnerCode=${c.partnerCode}` +
    `&redirectUrl=${p.redirectUrl}` +
    `&requestId=${p.requestId}` +
    `&requestType=${requestType}`
  );
}

/** Full JSON body (with signature) to POST to the create endpoint. */
export function createRequestBody(c: MomoConfig, p: CreateParams): Record<string, string | number> {
  const extraData = p.extraData ?? "";
  const requestType = p.requestType ?? "captureWallet";
  return {
    partnerCode: c.partnerCode,
    accessKey: c.accessKey,
    requestId: p.requestId,
    amount: p.amount,
    orderId: p.orderId,
    orderInfo: p.orderInfo,
    redirectUrl: p.redirectUrl,
    ipnUrl: p.ipnUrl,
    extraData,
    requestType,
    lang: "vi",
    signature: hmac(createRawSignature(c, p), c.secretKey),
  };
}

/** Fields MoMo sends on the IPN callback (superset; only the signed ones matter). */
export interface IpnFields {
  partnerCode: string;
  orderId: string;
  requestId: string;
  amount: number;
  orderInfo: string;
  orderType: string;
  transId: number;
  resultCode: number;
  message: string;
  payType: string;
  responseTime: number;
  extraData: string;
  signature: string;
}

/** The exact field string MoMo signs for an IPN — different order from create. */
export function ipnRawSignature(c: MomoConfig, f: IpnFields): string {
  return (
    `accessKey=${c.accessKey}` +
    `&amount=${f.amount}` +
    `&extraData=${f.extraData}` +
    `&message=${f.message}` +
    `&orderId=${f.orderId}` +
    `&orderInfo=${f.orderInfo}` +
    `&orderType=${f.orderType}` +
    `&partnerCode=${f.partnerCode}` +
    `&payType=${f.payType}` +
    `&requestId=${f.requestId}` +
    `&responseTime=${f.responseTime}` +
    `&resultCode=${f.resultCode}` +
    `&transId=${f.transId}`
  );
}

/** Constant-time check that the IPN was signed by our secret. */
export function verifyIpn(c: MomoConfig, f: IpnFields): boolean {
  const expected = hmac(ipnRawSignature(c, f), c.secretKey);
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(f.signature ?? "", "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** resultCode 0 is success; every other code is a non-grant. */
export function isPaid(f: Pick<IpnFields, "resultCode">): boolean {
  return f.resultCode === 0;
}
