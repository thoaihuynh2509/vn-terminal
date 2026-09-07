import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS, parseSettings, restorable, serializeSettings } from "./settings.ts";

const known = (id: string) => ["sma20", "rsi", "macd", "bb"].includes(id);

test("settings round-trip", () => {
  const s = { type: "line" as const, indicators: ["sma20", "rsi"], scale: "lin" as const };
  assert.deepEqual(parseSettings(serializeSettings(s)), s);
});

test("nothing stored is null, not a default — the caller decides", () => {
  assert.equal(parseSettings(null), null);
  assert.equal(parseSettings(""), null);
});

test("corrupt storage yields null rather than throwing", () => {
  // Reader-owned storage: an extension, an older build or a half-written value
  // must cost the reader a default chart, never an error page.
  for (const bad of ["{", "[]", "null", "true", '"a string"', "{oops}"]) {
    assert.doesNotThrow(() => parseSettings(bad));
  }
  assert.equal(parseSettings("{"), null);
  assert.equal(parseSettings("null"), null);
});

test("an unknown chart type falls back instead of rendering nothing", () => {
  const s = parseSettings('{"type":"renko","indicators":[]}');
  assert.equal(s?.type, DEFAULT_SETTINGS.type);
});

test("indicator ids that are not ids are dropped", () => {
  const s = parseSettings('{"type":"candle","indicators":["sma20","../x","",123,"x y","ok2"]}');
  assert.deepEqual(s?.indicators, ["sma20", "ok2"]);
});

test("a stored id is normalised rather than discarded for its case", () => {
  // Deliberate change with P2-10: `parseRef` now owns the token grammar for the
  // URL and for storage alike. The URL path always lowercased, while storage
  // rejected uppercase outright, so the same id behaved differently depending
  // on where it came from. One grammar, and "RSI" is the reader's own id.
  assert.deepEqual(parseSettings('{"type":"candle","indicators":["RSI"]}')?.indicators, ["rsi"]);
});

test("duplicate indicators collapse", () => {
  const s = parseSettings('{"type":"candle","indicators":["rsi","rsi","sma20"]}');
  assert.deepEqual(s?.indicators, ["rsi", "sma20"]);
});

test("a non-array indicators field is treated as empty", () => {
  assert.deepEqual(parseSettings('{"type":"candle","indicators":"rsi"}')?.indicators, []);
});

test("restoring is capped by the tier's budget", () => {
  // A reader who had eight indicators on Plus and lapsed must come back to a
  // working chart, not one silently over budget that refuses the next toggle.
  const s = { type: "candle" as const, indicators: ["sma20", "rsi", "macd", "bb"], scale: "lin" as const };
  assert.deepEqual(restorable(s, 2, known).indicators, ["sma20", "rsi"]);
  assert.deepEqual(restorable(s, 0, known).indicators, []);
  assert.deepEqual(restorable(s, 99, known).indicators, s.indicators);
});

test("restoring drops indicators the build no longer ships", () => {
  const s = { type: "candle" as const, indicators: ["sma20", "removedone", "rsi"], scale: "lin" as const };
  assert.deepEqual(restorable(s, 10, known).indicators, ["sma20", "rsi"]);
});

test("restoring never invents a type", () => {
  assert.equal(restorable({ type: "area", indicators: [], scale: "lin" as const }, 5, known).type, "area");
});

// ── P2-10: tuned periods must survive a reload ──────────────────────
test("a tuned indicator survives being stored and read back", () => {
  const round = parseSettings(serializeSettings({ type: "line", indicators: ["rsi:21", "sma20"], scale: "lin" as const }));
  assert.deepEqual(round?.indicators, ["rsi:21", "sma20"]);
});

test("restorable asks about the indicator, not the whole token", () => {
  // Passing `rsi:21` to a registry lookup would make every tuned indicator
  // look unknown and silently vanish on reload.
  const known = (id: string) => id === "rsi";
  assert.deepEqual(
    restorable({ type: "candle", indicators: ["rsi:21", "bogus:5"], scale: "lin" as const }, 8, known).indicators,
    ["rsi:21"],
  );
});

test("stored settings drop a malformed token instead of trusting it", () => {
  const s = parseSettings(JSON.stringify({ type: "candle", indicators: ["rsi:21", "rsi:0", 7, "x y"], scale: "lin" as const }));
  assert.deepEqual(s?.indicators, ["rsi:21"]);
});
