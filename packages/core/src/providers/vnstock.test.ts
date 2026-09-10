import assert from "node:assert/strict";
import test from "node:test";
import { quoteFromRow, type VpsRow } from "./vnstock.ts";

/**
 * Rows below are verbatim from the VPS board feed (probed 2026-09-10) and then
 * cross-checked against the same session's DNSE daily bars, which is how the
 * three conventions asserted here were found.
 */
const row = (over: Partial<VpsRow>): VpsRow => ({
  sym: "FPT", lastPrice: 74.5, r: 72.4, lot: 1193660,
  openPrice: "72.3", highPrice: "74.8", lowPrice: "72.2",
  ...over,
});

const near = (a: number | undefined, b: number) =>
  assert.ok(a !== undefined && Math.abs(a - b) < 1e-9, `${a} ≉ ${b}`);

test("a rising symbol maps straight through", () => {
  const q = quoteFromRow(row({}))!;
  assert.equal(q.symbol, "FPT");
  assert.equal(q.price, 74.5);
  assert.equal(q.prevClose, 72.4);
  near(q.change, 2.1);
  near(q.changePct, (2.1 / 72.4) * 100); // 2.90%, matching the feed's own figure
  assert.equal(q.open, 72.3);            // strings become numbers
  assert.equal(q.high, 74.8);
  assert.equal(q.low, 72.2);
});

test("volume is lots of ten, not shares", () => {
  // DNSE reported 11,936,600 shares for the same session; the feed sends lots.
  assert.equal(quoteFromRow(row({}))!.volume, 11_936_600);
});

test("a decliner goes NEGATIVE even though the feed reports it unsigned", () => {
  // The trap: HPG fell 0.20 that session and the feed still sends "0.20".
  // Direction has to come from lastPrice against reference, or every falling
  // stock renders as a gainer.
  const q = quoteFromRow(row({ sym: "HPG", lastPrice: 21.85, r: 22.05, lot: 1339140 }))!;
  near(q.change, -0.2);
  assert.ok(q.changePct < 0, "a decliner must not report a positive percentage");
  near(q.changePct, (-0.2 / 22.05) * 100);
});

test("no trade yet reads as flat at reference, never as down 100%", () => {
  // The feed sends lastPrice 0 before the session's first match.
  const q = quoteFromRow(row({ lastPrice: 0 }))!;
  assert.equal(q.price, 72.4);
  assert.equal(q.change, 0);
  assert.equal(q.changePct, 0);
});

test("a row with no price at all is dropped rather than charted as zero", () => {
  assert.equal(quoteFromRow(row({ lastPrice: 0, r: 0 })), null);
  assert.equal(quoteFromRow(row({ sym: "" })), null);
});

test("absent optional fields stay absent instead of becoming NaN", () => {
  const q = quoteFromRow(row({ highPrice: "", lowPrice: "n/a" }))!;
  assert.equal(q.high, undefined);
  assert.equal(q.low, undefined);
});
