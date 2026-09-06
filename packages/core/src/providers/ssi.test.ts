import assert from "node:assert/strict";
import test from "node:test";
import { parseForeign, ssiConfig } from "./ssi.ts";

function withEnv<T>(v: Record<string, string | undefined>, fn: () => T): T {
  const keys = ["SSI_CONSUMER_ID", "SSI_CONSUMER_SECRET"];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  try {
    for (const k of keys) delete process.env[k];
    for (const [k, val] of Object.entries(v)) if (val !== undefined) process.env[k] = val;
    return fn();
  } finally {
    for (const [k, val] of Object.entries(saved)) { if (val === undefined) delete process.env[k]; else process.env[k] = val; }
  }
}

test("parseForeign computes net = buy − sell, normalises the date, sorts ascending", () => {
  const out = parseForeign([
    { TradingDate: "05/09/2026", ForeignBuyVolTotal: "1,000", ForeignSellVolTotal: 400, ForeignBuyValTotal: "60,000", ForeignSellValTotal: 25000 },
    { TradingDate: "04/09/2026", ForeignBuyVolTotal: 200, ForeignSellVolTotal: 900, ForeignBuyValTotal: 12000, ForeignSellValTotal: 50000 },
  ]);
  assert.deepEqual(out.map((f) => f.date), ["2026-09-04", "2026-09-05"]);
  assert.equal(out[1].netVol, 600);        // 1000 − 400, comma-tolerant
  assert.equal(out[1].netVal, 35000);      // 60000 − 25000
  assert.equal(out[0].netVol, -700);       // net SELL day
  assert.equal(out[0].netVal, -38000);
});

test("rows without a trading date are dropped; missing fields count as 0", () => {
  const out = parseForeign([{ ForeignBuyVolTotal: 5 } as never, { TradingDate: "01/09/2026" }]);
  assert.equal(out.length, 1);
  assert.equal(out[0].netVol, 0);
});

test("no credentials → config null (feature fails closed)", () => {
  assert.equal(withEnv({}, ssiConfig), null);
  assert.deepEqual(withEnv({ SSI_CONSUMER_ID: "x", SSI_CONSUMER_SECRET: "y" }, ssiConfig), { consumerId: "x", consumerSecret: "y" });
});
