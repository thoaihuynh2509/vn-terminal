import assert from "node:assert/strict";
import test from "node:test";
import { isBufferKey, isEditable, resolveTyped, stepTimeframe } from "./tf-keys.ts";

test("a keystroke inside a field belongs to the field", () => {
  // The alert price input is on the chart page: this is the regression that
  // would change the timeframe every time someone types a price.
  assert.equal(isEditable({ tagName: "INPUT" }), true);
  assert.equal(isEditable({ tagName: "input" }), true, "tag case must not matter");
  assert.equal(isEditable({ tagName: "TEXTAREA" }), true);
  assert.equal(isEditable({ tagName: "SELECT" }), true);
  assert.equal(isEditable({ tagName: "DIV", isContentEditable: true }), true);
  assert.equal(isEditable({ tagName: "DIV" }), false);
  assert.equal(isEditable(null), false);
});

test("stepping moves one interval at a time", () => {
  assert.equal(stepTimeframe("1D", 1, true), "1W");
  assert.equal(stepTimeframe("1D", -1, true), "4h");
  assert.equal(stepTimeframe("5m", 1, true), "15m");
});

test("stepping stops at the ends instead of wrapping", () => {
  assert.equal(stepTimeframe("1m", -1, true), null, "shortest interval is a floor");
  assert.equal(stepTimeframe("12M", 1, true), null, "longest interval is a ceiling");
});

test("a reader without intraday never steps into a locked interval", () => {
  assert.equal(stepTimeframe("1D", -1, false), null, "nothing shorter is available");
  assert.equal(stepTimeframe("1D", 1, false), "1W");
  assert.equal(stepTimeframe("1W", -1, false), "1D", "steps over the whole intraday block");
});

test("an unknown current interval steps nowhere", () => {
  assert.equal(stepTimeframe("99x", 1, true), null);
});

test("typing resolves the plain cases", () => {
  assert.equal(resolveTyped("15m"), "15m");
  assert.equal(resolveTyped("1h"), "1h");
  assert.equal(resolveTyped("1d"), "1D");
  assert.equal(resolveTyped("1D"), "1D");
  assert.equal(resolveTyped("1w"), "1W");
});

test("case decides between minutes and months", () => {
  assert.equal(resolveTyped("1m"), "1m", "lowercase m is minutes");
  assert.equal(resolveTyped("1M"), "1M", "uppercase M is months");
  assert.equal(resolveTyped("3m"), "3m");
  assert.equal(resolveTyped("3M"), "3M");
});

test("an unambiguous number falls through to the other unit", () => {
  // There is no 6-minute or 12-minute interval, so the reader can only have
  // meant months — doing nothing would just look broken.
  assert.equal(resolveTyped("6m"), "6M");
  assert.equal(resolveTyped("12m"), "12M");
});

test("60m is an hour", () => {
  assert.equal(resolveTyped("60m"), "1h");
  assert.equal(resolveTyped("120m"), "2h");
  assert.equal(resolveTyped("240m"), "4h");
});

test("nonsense resolves to nothing rather than to a guess", () => {
  for (const s of ["", "m", "5", "5z", "999m", "1hh", "abc", "-5m", "5 m"]) {
    assert.equal(resolveTyped(s), null, `expected null for ${JSON.stringify(s)}`);
  }
});

test("only alphanumerics build the buffer", () => {
  assert.equal(isBufferKey("5"), true);
  assert.equal(isBufferKey("m"), true);
  assert.equal(isBufferKey("Enter"), false, "named keys must not be appended");
  assert.equal(isBufferKey(" "), false);
  assert.equal(isBufferKey("["), false);
});
