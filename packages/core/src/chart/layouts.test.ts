import test from "node:test";
import assert from "node:assert/strict";
import {
  isValidName, layoutFromQuery, layoutQuery, mergeLayouts, normaliseName, parseLayout, parseLayouts,
  removeLayout, serializeLayouts, sortLayouts, upsertLayout, type SavedLayout,
} from "./layouts.ts";
import { LAYOUT_LIMIT } from "../auth/entitlement.ts";

const L = (over: Partial<SavedLayout> = {}): SavedLayout => ({
  name: "Bank screen", symbol: "VCB", extra: [], grid: 1, tf: "1D", type: "candle",
  ind: [], range: null, cmp: [], fr: false, br: false, savedAt: 1000, ...over,
});

test("a saved layout round-trips through storage", () => {
  const one = L({ extra: ["CTG", "BID"], grid: 4, ind: ["rsi:21"], cmp: ["VNINDEX"], fr: true });
  assert.deepEqual(parseLayouts(serializeLayouts([one])), [one]);
});

test("a layout from a newer build degrades to a chart that opens", () => {
  // Anything unrecognised must default, never throw on the rail.
  const l = parseLayout({ name: "x", symbol: "vnm", grid: 9, type: "renko", scale: "log", ind: "nope" });
  assert.deepEqual(l, {
    name: "x", symbol: "VNM", extra: [], grid: 1, tf: "1D", type: "candle",
    ind: [], range: null, cmp: [], fr: false, br: false, savedAt: 0,
  });
});

test("a layout with no name or no symbol is not a layout", () => {
  assert.equal(parseLayout({ symbol: "VNM" }), null);
  assert.equal(parseLayout({ name: "ok" }), null);
  assert.equal(parseLayout(null), null);
  assert.equal(parseLayout([]), null);
});

test("corrupt storage yields no layouts rather than throwing", () => {
  assert.deepEqual(parseLayouts("{oops"), []);
  assert.deepEqual(parseLayouts(null), []);
  assert.deepEqual(parseLayouts('{"not":"an array"}'), []);
});

test("names accepted here are names the database will accept", () => {
  // A name this allows but migration 006 rejects would look like a save that
  // worked and then vanished on the next device.
  assert.ok(isValidName("Bank screen"));
  assert.ok(isValidName("VN30_4up.v2"));
  assert.ok(!isValidName(""));
  assert.ok(!isValidName(" leading"));
  assert.ok(!isValidName("has/slash"));
  assert.ok(!isValidName("emoji 🎉"));
  assert.ok(!isValidName("x".repeat(65)));
});

test("a typed name is tidied before it becomes a key", () => {
  assert.equal(normaliseName("  Bank   screen  "), "Bank screen");
  assert.equal(normaliseName("x".repeat(200)).length, 64);
});

test("saving stops at the tier's ceiling", () => {
  let list: SavedLayout[] = [];
  const tier = "free" as const;
  for (let i = 0; i < LAYOUT_LIMIT[tier]; i++) {
    const r = upsertLayout(list, L({ name: `s${i}` }), tier);
    assert.ok(r.ok, `slot ${i}`);
    list = r.list!;
  }
  const over = upsertLayout(list, L({ name: "one too many" }), tier);
  assert.equal(over.ok, false);
  assert.equal(over.error, "limit");
  assert.equal(over.limit, LAYOUT_LIMIT[tier]);
});

test("re-saving an existing name is allowed AT the cap", () => {
  // Otherwise the last slot silently becomes read-only, which reads as a bug
  // rather than as a limit — the same rule validateDoc applies server-side.
  const list = Array.from({ length: LAYOUT_LIMIT.plus }, (_, i) => L({ name: `s${i}` }));
  const r = upsertLayout(list, L({ name: "s0", symbol: "FPT", savedAt: 9999 }), "plus");
  assert.ok(r.ok);
  assert.equal(r.list!.length, LAYOUT_LIMIT.plus);
  assert.equal(r.list!.find((l) => l.name === "s0")!.symbol, "FPT");
});

test("anon cannot save at all", () => {
  assert.equal(LAYOUT_LIMIT.anon, 0);
  assert.equal(upsertLayout([], L(), "anon").ok, false);
});

test("an unusable name is refused before it reaches the cap", () => {
  assert.equal(upsertLayout([], L({ name: "bad/name" }), "pro").error, "bad_name");
});

test("deleting removes exactly one layout", () => {
  const list = [L({ name: "a" }), L({ name: "b" })];
  assert.deepEqual(removeLayout(list, "a").map((l) => l.name), ["b"]);
  assert.deepEqual(removeLayout(list, "missing").map((l) => l.name), ["a", "b"]);
});

test("layouts list newest first", () => {
  const out = sortLayouts([L({ name: "old", savedAt: 1 }), L({ name: "new", savedAt: 9 })]);
  assert.deepEqual(out.map((l) => l.name), ["new", "old"]);
});

test("two devices keep both layouts, and the newer copy of a shared name", () => {
  const local = [L({ name: "desk", savedAt: 5 }), L({ name: "shared", symbol: "AAA", savedAt: 10 })];
  const remote = [L({ name: "phone", savedAt: 7 }), L({ name: "shared", symbol: "BBB", savedAt: 3 })];
  const merged = mergeLayouts(local, remote);
  assert.deepEqual(merged.map((l) => l.name).sort(), ["desk", "phone", "shared"]);
  assert.equal(merged.find((l) => l.name === "shared")!.symbol, "AAA");
});

test("a merge never resurrects an older copy over a fresh local save", () => {
  const local = [L({ name: "s", symbol: "NEW", savedAt: 100 })];
  const remote = [L({ name: "s", symbol: "OLD", savedAt: 99 })];
  assert.equal(mergeLayouts(local, remote)[0].symbol, "NEW");
});

test("a remote layout the browser has never seen is adopted", () => {
  assert.deepEqual(mergeLayouts([], [L({ name: "phone" })]).map((l) => l.name), ["phone"]);
});

test("a plain layout recalls to a clean URL", () => {
  // Carrying its own defaults would make every shared link noisy.
  assert.equal(layoutQuery(L()), "");
});

test("the query reproduces everything the layout captured", () => {
  const q = new URLSearchParams(layoutQuery(L({
    tf: "1h", grid: 4, extra: ["FPT", "HPG"], type: "line",
    ind: ["rsi:21", "sma20"], range: "3M", cmp: ["VNINDEX"], fr: true, br: true,
  })));
  assert.equal(q.get("tf"), "1h");
  assert.equal(q.get("layout"), "4");
  assert.equal(q.get("s"), "FPT,HPG");
  assert.equal(q.get("type"), "line");
  assert.equal(q.get("ind"), "rsi:21,sma20");
  assert.equal(q.get("r"), "3M");
  assert.equal(q.get("cmp"), "VNINDEX");
  assert.equal(q.get("fr"), "1");
  assert.equal(q.get("br"), "1");
});

test("companion symbols are dropped when the grid is a single chart", () => {
  // Recalling `?s=FPT` on a one-up chart would carry symbols nothing renders.
  assert.equal(new URLSearchParams(layoutQuery(L({ grid: 1, extra: ["FPT"] }))).get("s"), null);
});

test("a duplicated name in storage collapses to one entry", () => {
  const raw = serializeLayouts([L({ name: "dup", symbol: "AAA" }), L({ name: "dup", symbol: "BBB" })]);
  const out = parseLayouts(raw);
  assert.equal(out.length, 1);
  assert.equal(out[0].symbol, "AAA");
});

test("a layout captured from the address bar recalls to the same chart", () => {
  // The round trip is the whole contract: capture reads the URL, recall
  // rebuilds it, and a drift between the two silently changes the reader's setup.
  const search = "?tf=1h&layout=4&s=FPT,HPG&type=line&ind=rsi:21,sma20&r=3M&cmp=VNINDEX&fr=1&br=1";
  const captured = layoutFromQuery("Desk", "VCB", search, 42)!;
  const round = new URLSearchParams(layoutQuery(captured));
  const original = new URLSearchParams(search.slice(1));
  for (const k of ["tf", "layout", "s", "type", "ind", "r", "cmp", "fr", "br"]) {
    assert.equal(round.get(k), original.get(k), k);
  }
});

test("capturing a default chart stores a layout with nothing extra", () => {
  const l = layoutFromQuery("Plain", "VNM", "", 1)!;
  assert.equal(layoutQuery(l), "");
  assert.equal(l.symbol, "VNM");
  assert.equal(l.grid, 1);
});

test("capture ignores parameters that are not part of a setup", () => {
  // `rail` and `src` describe how the reader arrived, not what they configured.
  const l = layoutFromQuery("X", "VNM", "?rail=alerts&src=brief&tf=1W", 1)!;
  assert.equal(layoutQuery(l), "tf=1W");
});

test("a capture with an unusable name is refused, not stored half-formed", () => {
  assert.equal(layoutFromQuery("bad/name", "VNM", "", 1), null);
});
