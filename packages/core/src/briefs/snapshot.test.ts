import test from "node:test";
import assert from "node:assert/strict";
import { composeSnapshot, parseSnapshot, SNAPSHOT_VERSION } from "./snapshot.ts";
import type { BriefInputs } from "./snapshot.ts";
import type { Coin, Quote } from "../types.ts";

const AT = Date.UTC(2026, 8, 10, 8, 15);

function quote(symbol: string, changePct: number, spark?: number[]): Quote {
  return { symbol, price: 100 + changePct, change: changePct, changePct, volume: 1_000_000, ...(spark ? { spark } : {}) };
}

function coin(symbol: string, sparkline?: number[]): Coin {
  return {
    id: symbol.toLowerCase(), symbol, name: symbol, price: 60000, changePct24h: 1.5,
    marketCap: 1e12, volume24h: 1e10, rank: 1, ...(sparkline ? { sparkline } : {}),
  };
}

function inputs(over: Partial<BriefInputs> = {}): BriefInputs {
  return {
    indices: [quote("VNINDEX", 0.8, [1, 2, 3, 4, 5])],
    board: [quote("VNM", 1.2, [1, 2, 3]), quote("HPG", -0.6, [3, 2, 1]), quote("FPT", 0, [2, 2, 2])],
    gold: null,
    coins: [coin("BTC", [10, 11, 12, 13])],
    ...over,
  };
}

test("both locales are composed from the same figures, at capture time", () => {
  const snap = composeSnapshot("2026-09-10", inputs(), AT);
  assert.equal(snap.v, SNAPSHOT_VERSION);
  assert.equal(snap.day, "2026-09-10");
  assert.equal(snap.capturedAt, new Date(AT).toISOString());
  assert.ok(snap.vi.headline.length > 0);
  assert.ok(snap.en.headline.length > 0);
  assert.notEqual(snap.vi.headline, snap.en.headline);
  // Composed together so the two pages can never disagree about a number.
  assert.equal(snap.vi.paragraphs.length, snap.en.paragraphs.length);
});

test("the visuals the archived page redraws are kept", () => {
  const snap = composeSnapshot("2026-09-10", inputs(), AT);
  assert.equal(snap.visuals.board.length, 3);
  assert.deepEqual(snap.visuals.vnindexSpark, [1, 2, 3, 4, 5]);
  assert.equal(snap.visuals.vnindexChangePct, 0.8);
  assert.deepEqual(snap.visuals.btcSpark, [10, 11, 12, 13]);
  assert.equal(snap.visuals.btcChangePct24h, 1.5);
});

test("an explicit spark series wins over the row's own", () => {
  const snap = composeSnapshot("2026-09-10", inputs({ sparks: { VNINDEX: [9, 9, 9, 9] } }), AT);
  assert.deepEqual(snap.visuals.vnindexSpark, [9, 9, 9, 9]);
});

test("per-row sparklines are dropped, because nothing archived draws them", () => {
  const snap = composeSnapshot("2026-09-10", inputs(), AT);
  for (const row of snap.visuals.board) {
    assert.equal("spark" in row, false, `${row.symbol} kept its sparkline`);
  }
  // The rows themselves survive: breadth and sector bars are computed from them.
  assert.deepEqual(snap.visuals.board.map((q) => q.symbol), ["VNM", "HPG", "FPT"]);
});

test("a series too short to plot is left out rather than stored as a stub", () => {
  const snap = composeSnapshot("2026-09-10", inputs({
    indices: [quote("VNINDEX", 0.8, [1, 2])],
    coins: [coin("BTC", [1, 2])],
  }), AT);
  assert.equal(snap.visuals.vnindexSpark, undefined);
  assert.equal(snap.visuals.btcSpark, undefined);
});

test("a snapshot round-trips through JSON, which is how it is stored", () => {
  const snap = composeSnapshot("2026-09-10", inputs(), AT);
  const back = parseSnapshot(JSON.parse(JSON.stringify(snap)));
  assert.deepEqual(back, snap);
});

test("anything that is not a snapshot reads as absent, never as a throw", () => {
  for (const junk of [null, undefined, 42, "brief", [], {}, { day: "2026-09-10" }]) {
    assert.equal(parseSnapshot(junk), null, `accepted ${JSON.stringify(junk)}`);
  }
  // A document with one locale is not renderable in the other, so it is not one.
  const snap = composeSnapshot("2026-09-10", inputs(), AT);
  const half = JSON.parse(JSON.stringify(snap));
  delete half.en;
  assert.equal(parseSnapshot(half), null);
});

test("a document written by an older deploy still renders", () => {
  // Tolerance is the point: a missing visuals block must degrade to no charts,
  // not take down a page whose prose is intact.
  const snap = composeSnapshot("2026-09-10", inputs(), AT);
  const older = JSON.parse(JSON.stringify(snap));
  delete older.visuals;
  delete older.capturedAt;
  delete older.v;
  const back = parseSnapshot(older);
  assert.ok(back);
  assert.deepEqual(back.visuals.board, []);
  assert.equal(back.capturedAt, "2026-09-10T00:00:00.000Z");
  assert.equal(back.vi.headline, snap.vi.headline);
});

test("a corrupt visuals block is dropped without dropping the brief", () => {
  const snap = composeSnapshot("2026-09-10", inputs(), AT);
  const bent = JSON.parse(JSON.stringify(snap));
  bent.visuals = { board: [{ nope: 1 }, "x", null], vnindexSpark: ["a", "b"], btcSpark: [1, null] };
  const back = parseSnapshot(bent);
  assert.ok(back);
  assert.deepEqual(back.visuals.board, []);
  assert.equal(back.visuals.vnindexSpark, undefined);
  assert.equal(back.visuals.btcSpark, undefined);
  assert.ok(back.vi.paragraphs.length > 0);
});
