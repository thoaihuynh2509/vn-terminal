import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_VIEW, decodeView, encodeView, mergeViewIntoQuery } from "./view-state.ts";
import { INDICATOR_LIMIT } from "../auth/entitlement.ts";

const KNOWN = ["sma20", "sma50", "rsi", "macd", "bb", "vwap", "atr", "obv", "cci", "adx"];
const FREE = ["sma20", "rsi"];
const opts = (tier: "anon" | "free" | "plus" | "pro") => ({
  tier,
  known: (id: string) => KNOWN.includes(id),
  isFree: (id: string) => FREE.includes(id),
});

test("an empty query is the default view", () => {
  assert.deepEqual(decodeView({}, opts("pro")), DEFAULT_VIEW);
});

test("a view round-trips through the query string", () => {
  const view = { type: "line" as const, ind: ["sma20", "rsi"], range: "3M" as const };
  assert.deepEqual(decodeView(Object.fromEntries(new URLSearchParams(encodeView(view))), opts("pro")), view);
});

test("defaults are omitted so a plain chart has a clean link", () => {
  assert.equal(encodeView(DEFAULT_VIEW), "");
  assert.equal(encodeView({ type: "candle", ind: [], range: "1Y" }), "r=1Y");
});

test("an unknown type or range falls back instead of 404ing", () => {
  // A link from an older build, or one mangled by a chat client, must still
  // open the chart it names.
  const v = decodeView({ type: "renko", r: "10Y" }, opts("pro"));
  assert.equal(v.type, "candle");
  assert.equal(v.range, null);
});

test("indicators the build no longer ships are dropped", () => {
  assert.deepEqual(decodeView({ ind: "sma20,removedone,rsi" }, opts("pro")).ind, ["sma20", "rsi"]);
});

test("junk in the id list cannot get through", () => {
  const v = decodeView({ ind: "../etc,<script>,,   ,SMA20,sma20" }, opts("pro"));
  // "SMA20" lowercases to a known id; the rest are refused. No duplicates.
  assert.deepEqual(v.ind, ["sma20"]);
});

test("a link cannot grant an entitlement", () => {
  // The bug this guards: a paid indicator arriving in the query string must be
  // dropped BEFORE render, not drawn and then retracted.
  const v = decodeView({ ind: "macd,bb,rsi" }, opts("free"));
  assert.deepEqual(v.ind, ["rsi"], "only the free ones survive on a free tier");
});

test("the indicator list is clamped to the tier's budget", () => {
  const many = KNOWN.join(",");
  for (const tier of ["anon", "free", "plus", "pro"] as const) {
    const v = decodeView({ ind: many }, opts(tier));
    assert.ok(v.ind.length <= INDICATOR_LIMIT[tier], `${tier}: ${v.ind.length}`);
  }
});

test("a hostile id list is bounded rather than walked", () => {
  const v = decodeView({ ind: Array.from({ length: 5000 }, () => "sma20").join(",") }, opts("pro"));
  assert.deepEqual(v.ind, ["sma20"]);
});

test("merging preserves every parameter this module does not own", () => {
  // Rewriting the whole query string would silently drop the reader's grid.
  const merged = mergeViewIntoQuery(
    "tf=1h&layout=4&s=FPT,HPG&cmp=1&fr=1&rail=alerts&type=area&ind=old&r=1M",
    { type: "line", ind: ["rsi"], range: "6M" },
  );
  const p = new URLSearchParams(merged);
  assert.equal(p.get("tf"), "1h");
  assert.equal(p.get("layout"), "4");
  assert.equal(p.get("s"), "FPT,HPG");
  assert.equal(p.get("cmp"), "1");
  assert.equal(p.get("fr"), "1");
  assert.equal(p.get("rail"), "alerts");
  assert.equal(p.get("type"), "line");
  assert.equal(p.get("ind"), "rsi");
  assert.equal(p.get("r"), "6M");
});

test("merging a default view clears the keys rather than writing them", () => {
  const merged = mergeViewIntoQuery("tf=1D&type=line&ind=rsi&r=1M", DEFAULT_VIEW);
  const p = new URLSearchParams(merged);
  assert.equal(p.get("tf"), "1D", "the timeframe is not ours to touch");
  assert.equal(p.get("type"), null);
  assert.equal(p.get("ind"), null);
  assert.equal(p.get("r"), null);
});

// ── P2-10: tuned indicator periods ──────────────────────────────────
const anyKnown = { tier: "pro" as const, known: () => true, isFree: () => true };

test("a tuned period survives the URL", () => {
  assert.deepEqual(decodeView({ ind: "rsi:21,sma20:50" }, anyKnown).ind, ["rsi:21", "sma20:50"]);
});

test("a link written before periods existed still opens", () => {
  assert.deepEqual(decodeView({ ind: "rsi,sma20" }, anyKnown).ind, ["rsi", "sma20"]);
});

test("the same indicator twice is one entry, whatever the tunings", () => {
  // `rsi,rsi:21` is one reader changing their mind, not two RSI panes.
  assert.deepEqual(decodeView({ ind: "rsi,rsi:21" }, anyKnown).ind, ["rsi"]);
});

test("a malformed period drops that indicator rather than guessing one", () => {
  assert.deepEqual(decodeView({ ind: "rsi:0,sma20:abc,atr:14" }, anyKnown).ind, ["atr:14"]);
});

test("a tuned paid indicator is still refused to a tier that cannot see it", () => {
  // The period must not become a way around the gate.
  const out = decodeView(
    { ind: "sma50:200" },
    { tier: "anon", known: () => true, isFree: (id) => id === "rsi" },
  );
  assert.deepEqual(out.ind, []);
});

test("tuned views round-trip through encode", () => {
  const view = { type: "candle" as const, ind: ["rsi:21"], range: null };
  assert.deepEqual(decodeView({ ind: new URLSearchParams(encodeView(view)).get("ind") }, anyKnown).ind, ["rsi:21"]);
});
