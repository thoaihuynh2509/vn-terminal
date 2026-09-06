import assert from "node:assert/strict";
import test from "node:test";
import { isCustom, parseCustom, timeframe, TIMEFRAMES } from "./timeframes.ts";

test("a custom minute interval aggregates from a resolution that divides it", () => {
  // 7 does not divide by 30/15/5/3, so it must come from 1-minute bars or the
  // buckets would be stitched from partial source candles.
  assert.equal(parseCustom("7m")?.fetch, "1");
  assert.equal(parseCustom("10m")?.fetch, "5", "10 divides by 5, so fetch fewer bars");
  assert.equal(parseCustom("60m")?.fetch, "30");
  assert.equal(parseCustom("9m")?.fetch, "3");
});

test("every custom bucket is a whole multiple of what it fetches", () => {
  for (let n = 1; n <= 240; n++) {
    const t = parseCustom(`${n}m`);
    assert.ok(t?.bucket, `${n}m should parse into a bucket`);
    const src = Number(t.fetch) * 60;
    assert.equal(t.bucket % src, 0, `${n}m buckets must tile ${t.fetch}m bars exactly`);
  }
});

test("custom hour and day intervals are supported", () => {
  assert.equal(parseCustom("9h")?.bucket, 9 * 3600);
  assert.equal(parseCustom("9h")?.intraday, true);
  assert.equal(parseCustom("3D")?.bucket, 3 * 86400);
  assert.equal(parseCustom("3D")?.intraday, false, "a multi-day bar is not intraday");
});

test("absurd intervals are refused rather than served slowly", () => {
  assert.equal(parseCustom("5000m"), null);
  assert.equal(parseCustom("99h"), null);
  assert.equal(parseCustom("900D"), null);
  assert.equal(parseCustom("0m"), null);
});

test("malformed ids parse to nothing", () => {
  for (const s of ["", "m", "7", "7x", "-7m", "7 m", "7M", "7w", "abc"]) {
    assert.equal(parseCustom(s), null, `expected null for ${JSON.stringify(s)}`);
  }
});

test("a built-in interval is never treated as custom", () => {
  for (const t of TIMEFRAMES) assert.equal(isCustom(t.id), false, `${t.id} is built in`);
  assert.equal(isCustom("7m"), true);
});

test("resolving prefers the built-in table, then custom, then the default", () => {
  assert.equal(timeframe("1D").id, "1D");
  assert.equal(timeframe("7m").id, "7m", "a valid custom interval must survive the URL");
  assert.equal(timeframe("nonsense").id, "1D");
  assert.equal(timeframe(null).id, "1D");
});

test("a custom interval carries enough history to be worth drawing", () => {
  for (const id of ["7m", "45m", "9h", "3D"]) {
    const t = parseCustom(id);
    assert.ok(t && t.lookback >= 5, `${id} lookback too small`);
  }
});
