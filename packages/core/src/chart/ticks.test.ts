import { test } from "node:test";
import assert from "node:assert/strict";
import { tickLabel } from "./ticks.ts";

const at = (iso: string) => Date.parse(iso) / 1000;

test("a day tick carries its month, so two sessions a month apart never share a label", () => {
  assert.equal(tickLabel(at("2026-05-16T02:00:00Z"), "day", "vi"), "16/05");
  assert.notEqual(tickLabel(at("2026-05-16T02:00:00Z"), "day", "vi"), tickLabel(at("2026-06-16T02:00:00Z"), "day", "vi"));
});

test("ticks are in market time, not the viewer's", () => {
  // 20:00 UTC on the 15th is 03:00 on the 16th in Ho Chi Minh City.
  assert.equal(tickLabel(at("2026-05-15T20:00:00Z"), "day", "en"), "16/05");
  assert.equal(tickLabel(at("2026-05-15T20:00:00Z"), "time", "en"), "03:00");
});

test("a minute tick is a 24-hour clock", () => {
  assert.equal(tickLabel(at("2026-05-16T07:30:00Z"), "time", "vi"), "14:30");
});

test("a year tick is the year", () => {
  assert.equal(tickLabel(at("2026-01-02T02:00:00Z"), "year", "vi"), "2026");
});
