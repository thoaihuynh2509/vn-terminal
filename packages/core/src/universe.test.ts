import test from "node:test";
import assert from "node:assert/strict";
import {
  ALL_SYMBOLS, EXCHANGE_BAND, HNX_SYMBOLS, HOSE_SYMBOLS, UPCOM_SYMBOLS,
  bandOf, exchangeOf,
} from "./universe.ts";

test("each exchange carries its own daily price limit", () => {
  assert.equal(EXCHANGE_BAND.HOSE, 0.07);
  assert.equal(EXCHANGE_BAND.HNX, 0.10);
  assert.equal(EXCHANGE_BAND.UPCOM, 0.15);
});

test("a symbol resolves to the exchange it is listed on", () => {
  assert.equal(exchangeOf("VNM"), "HOSE");
  assert.equal(exchangeOf("SHS"), "HNX");
  assert.equal(exchangeOf("ACV"), "UPCOM");
});

test("lookup is case-insensitive — URLs arrive in any case", () => {
  assert.equal(exchangeOf("vnm"), "HOSE");
  assert.equal(exchangeOf("Shs"), "HNX");
});

test("an unknown symbol is NULL, never a guess", () => {
  // The whole point: a wrong band is a wrong number where readers trust most.
  assert.equal(exchangeOf("NOTLISTED"), null);
  assert.equal(bandOf("NOTLISTED"), null);
  assert.equal(exchangeOf(""), null);
});

test("the band follows the exchange", () => {
  assert.equal(bandOf("VNM"), 0.07);
  assert.equal(bandOf("SHS"), 0.10, "an HNX stock must not be drawn with HOSE limits");
  assert.equal(bandOf("ACV"), 0.15);
});

test("no symbol is claimed by two exchanges", () => {
  const all = [...HOSE_SYMBOLS, ...HNX_SYMBOLS, ...UPCOM_SYMBOLS];
  assert.equal(new Set(all).size, all.length, "a duplicate would make the band ambiguous");
});

test("every listed symbol looks like a ticker", () => {
  for (const s of ALL_SYMBOLS) assert.match(s, /^[A-Z0-9]{3,10}$/, s);
});

test("the universe is bigger than VN30 and every VN30 name survives", () => {
  assert.ok(ALL_SYMBOLS.length > HOSE_SYMBOLS.length);
  for (const s of HOSE_SYMBOLS) assert.equal(exchangeOf(s), "HOSE", s);
});

test("symbols that have moved between exchanges are omitted, not guessed", () => {
  // BSR/VTP/CTR/SIP all return bars but have moved at some point; listing one
  // under a stale exchange would produce a confidently wrong band.
  for (const s of ["BSR", "VTP", "CTR", "SIP"]) {
    assert.equal(exchangeOf(s), null, `${s} must not be claimed`);
  }
});
