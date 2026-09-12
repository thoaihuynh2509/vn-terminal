import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_APPEARANCE, parseAppearance } from "./appearance.ts";

test("a missing or corrupt appearance is the default chart", () => {
  assert.deepEqual(parseAppearance(undefined), DEFAULT_APPEARANCE);
  assert.deepEqual(parseAppearance("dark"), DEFAULT_APPEARANCE);
});

test("valid choices are kept and invalid ones fall back one by one", () => {
  const a = parseAppearance({ upColor: "#26A69A", downColor: "tomato", grid: false, magnet: "yes", volume: false });
  assert.equal(a.upColor, "#26a69a");
  assert.equal(a.downColor, "");
  assert.equal(a.grid, false);
  assert.equal(a.magnet, DEFAULT_APPEARANCE.magnet);
  assert.equal(a.volume, false);
});

test("the chart's look survives a save and reload, and an older setup reads as the defaults", async () => {
  const { parseSettings, serializeSettings, DEFAULT_SETTINGS } = await import("./settings.ts");
  const saved = { ...DEFAULT_SETTINGS, appearance: { ...DEFAULT_APPEARANCE, grid: false, upColor: "#2962ff" } };
  assert.deepEqual(parseSettings(serializeSettings(saved))?.appearance, saved.appearance);
  assert.deepEqual(parseSettings('{"type":"candle","indicators":[]}')?.appearance, DEFAULT_APPEARANCE);
});

test("the magnet puts a point on the nearest open, high, low or close", async () => {
  const { snapToBar } = await import("./appearance.ts");
  const bar = { o: 60, h: 64, l: 58, c: 62 };
  assert.equal(snapToBar(bar, 63.4), 64);
  assert.equal(snapToBar(bar, 58.9), 58);
  assert.equal(snapToBar(bar, 61.2), 62);
});
