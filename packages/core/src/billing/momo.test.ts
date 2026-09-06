import assert from "node:assert/strict";
import test from "node:test";
import { createHmac } from "node:crypto";
import {
  createRawSignature,
  createRequestBody,
  ipnRawSignature,
  isPaid,
  verifyIpn,
  type IpnFields,
  type MomoConfig,
} from "./momo.ts";

const cfg: MomoConfig = {
  partnerCode: "MOMOTEST",
  accessKey: "F8BBA842ECF85",
  secretKey: "K951B6PE1waDMi640xX08PD3vg6EkVlz",
  endpoint: "https://test-payment.momo.vn/v2/gateway/api/create",
};

const hmac = (raw: string) => createHmac("sha256", cfg.secretKey).update(raw, "utf8").digest("hex");

test("create signature uses MoMo's fixed field order, not alphabetical of our body", () => {
  const raw = createRawSignature(cfg, {
    amount: 99000,
    orderId: "ord-1",
    requestId: "req-1",
    orderInfo: "VN Terminal Plus",
    redirectUrl: "https://x.test/return",
    ipnUrl: "https://x.test/ipn",
  });
  assert.equal(
    raw,
    "accessKey=F8BBA842ECF85&amount=99000&extraData=&ipnUrl=https://x.test/ipn" +
      "&orderId=ord-1&orderInfo=VN Terminal Plus&partnerCode=MOMOTEST" +
      "&redirectUrl=https://x.test/return&requestId=req-1&requestType=captureWallet",
  );
});

test("create body carries the HMAC of exactly that raw string", () => {
  const p = {
    amount: 99000,
    orderId: "ord-1",
    requestId: "req-1",
    orderInfo: "VN Terminal Plus",
    redirectUrl: "https://x.test/return",
    ipnUrl: "https://x.test/ipn",
  };
  const body = createRequestBody(cfg, p);
  assert.equal(body.signature, hmac(createRawSignature(cfg, p)));
  assert.equal(body.partnerCode, cfg.partnerCode);
  assert.equal(body.amount, 99000);
});

const ipn = (over: Partial<IpnFields> = {}): IpnFields => {
  const base: Omit<IpnFields, "signature"> = {
    partnerCode: "MOMOTEST",
    orderId: "ord-1",
    requestId: "req-1",
    amount: 99000,
    orderInfo: "VN Terminal Plus",
    orderType: "momo_wallet",
    transId: 2589001234,
    resultCode: 0,
    message: "Successful.",
    payType: "qr",
    responseTime: 1700000000000,
    extraData: "",
  };
  return { ...base, signature: hmac(ipnRawSignature(cfg, base as IpnFields)), ...over };
};

test("a genuine IPN verifies; a tampered amount does not", () => {
  assert.ok(verifyIpn(cfg, ipn()));
  const forged = ipn({ amount: 1 }); // signature still for 99000
  assert.ok(!verifyIpn(cfg, forged), "changing the amount must break the signature");
});

test("a missing or wrong signature is rejected, never throws", () => {
  assert.ok(!verifyIpn(cfg, ipn({ signature: "" })));
  assert.ok(!verifyIpn(cfg, ipn({ signature: "deadbeef" })));
});

test("only resultCode 0 counts as paid", () => {
  assert.ok(isPaid({ resultCode: 0 }));
  assert.ok(!isPaid({ resultCode: 1006 }));
  assert.ok(!isPaid({ resultCode: 49 }));
});
