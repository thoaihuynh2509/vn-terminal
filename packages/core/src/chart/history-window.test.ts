import test from "node:test";
import assert from "node:assert/strict";
import { DAILY_FLOOR_ISO, INTRADAY_FLOOR_DAYS, atLeftEdge, grew, historyFailure, mergeBars, olderLead, olderWindow, wantsOlder } from "./history-window.ts";
import type { Bar } from "../types.ts";

const DAY = 86_400;
const bar = (t: number, c = 1): Bar => ({ t, o: c, h: c, l: c, c, v: 1 });
const run = (from: number, n: number, step = DAY) =>
  Array.from({ length: n }, (_, i) => bar(from + i * step));

test("older bars are prepended and the series stays ascending", () => {
  const merged = mergeBars(run(100 * DAY, 5), run(90 * DAY, 5));
  assert.equal(merged.length, 10);
  for (let i = 1; i < merged.length; i++) assert.ok(merged[i].t > merged[i - 1].t);
  assert.equal(merged[0].t, 90 * DAY);
});

test("the overlap between two requests is not duplicated", () => {
  // Two fetches will always share sessions; drawn twice they would double every
  // candle in the overlap.
  const existing = run(100 * DAY, 10);
  const older = run(95 * DAY, 10); // five bars overlap
  const merged = mergeBars(existing, older);
  assert.equal(merged.length, 15);
  assert.equal(new Set(merged.map((b) => b.t)).size, 15);
});

test("an overlapping bar keeps the copy already on screen", () => {
  // Drawings, alerts and the crosshair are pinned to the loaded copy; replacing
  // it gains nothing and can flicker.
  const existing = [bar(100 * DAY, 42)];
  const merged = mergeBars(existing, [bar(100 * DAY, 99)]);
  assert.equal(merged[0].c, 42);
});

test("a page with nothing new returns the array unchanged", () => {
  const existing = run(100 * DAY, 5);
  assert.equal(mergeBars(existing, []), existing);
  assert.equal(mergeBars(existing, run(100 * DAY, 5)), existing);
});

test("merging into an empty chart still sorts", () => {
  const merged = mergeBars([], [bar(3 * DAY), bar(1 * DAY), bar(2 * DAY)]);
  assert.deepEqual(merged.map((b) => b.t / DAY), [1, 2, 3]);
});

test("a bar with a nonsense timestamp is not merged in", () => {
  const merged = mergeBars(run(100 * DAY, 3), [bar(NaN), bar(50 * DAY)]);
  assert.equal(merged.length, 4);
  assert.ok(merged.every((b) => Number.isFinite(b.t)));
});

test("growth is what tells the caller to stop asking", () => {
  // Without this the chart re-requests the same empty window on every pan frame
  // once it reaches the feed's floor.
  const a = run(100 * DAY, 5);
  assert.equal(grew(a, mergeBars(a, run(90 * DAY, 3))), true);
  assert.equal(grew(a, mergeBars(a, [])), false);
  assert.equal(grew(a, mergeBars(a, a)), false);
});

test("the requested window ends before the oldest bar held", () => {
  // Asking up to and including it would refetch a bar we already have and, at
  // the floor, look like growth that never comes.
  const w = olderWindow(1_000_000, DAY, 100);
  assert.ok(w.to < 1_000_000);
  assert.ok(w.from < w.to);
});

test("the window over-fetches, because a calendar has weekends in it", () => {
  // Asking for exactly `count` days of clock time returns fewer than `count`
  // bars, and the chart would creep back a few sessions per request.
  const w = olderWindow(1_000_000, DAY, 100);
  assert.ok((w.to - w.from) / DAY > 100, `${(w.to - w.from) / DAY} days for 100 bars`);
});

test("the window scales with the interval", () => {
  const daily = olderWindow(1_000_000, DAY, 50);
  const minute = olderWindow(1_000_000, 60, 50);
  assert.ok(daily.to - daily.from > minute.to - minute.from);
});

test("a degenerate interval or count still yields a usable window", () => {
  const w = olderWindow(1_000_000, 0, 0);
  assert.ok(Number.isFinite(w.from) && Number.isFinite(w.to) && w.from < w.to);
});

test("the left edge is detected slightly before it is reached", () => {
  // So the fetch starts before the reader arrives.
  assert.equal(atLeftEdge(1000, 100, 0), false);
  assert.equal(atLeftEdge(1000, 100, 890), true, "within the margin");
  assert.equal(atLeftEdge(1000, 100, 900), true, "exactly at the edge");
});

test("showing everything is already at the edge", () => {
  assert.equal(atLeftEdge(1000, 0, 0), true);
  assert.equal(atLeftEdge(50, 100, 0), true);
});

test("the probed feed limits are recorded, not guessed", () => {
  // These are the only reason the caps are what they are; a future reader
  // should be able to re-probe and compare.
  assert.equal(DAILY_FLOOR_ISO, "2012-03-20");
  assert.equal(INTRADAY_FLOOR_DAYS, 90);
});

test("a rate limit or a server wobble is retried, never latched", () => {
  // The bug this pins: /api/bars allows 120 requests a minute, a pan used to
  // burst past that, and the 429 that came back stopped the chart from ever
  // loading older bars for that symbol again.
  assert.equal(historyFailure(429), "retry");
  assert.equal(historyFailure(500), "retry");
  assert.equal(historyFailure(502), "retry");
  assert.equal(historyFailure(503), "retry");
});

test("a refusal that will repeat forever stops the asking", () => {
  assert.equal(historyFailure(400), "stop"); // malformed range
  assert.equal(historyFailure(402), "stop"); // intraday needs a paid tier
  assert.equal(historyFailure(404), "stop");
});

test("choosing Tất cả is a request to see what is loaded, not to load more", () => {
  // The bug this pins: ALL resolved to bars.length, which atLeftEdge reads as
  // "at the edge", so picking it fetched a page of older bars — after which the
  // same count covered only the newest half of the series.
  assert.equal(wantsOlder({ fitAll: true, total: 433, range: 433, offset: 0 }), false);
  assert.equal(wantsOlder({ fitAll: true, total: 434, range: 433, offset: 0 }), false, "a bar appended while fitted");
});

test("a default window larger than what is loaded still extends itself", () => {
  // A monthly chart or a new listing: nobody chose to stop there.
  assert.equal(wantsOlder({ fitAll: false, total: 50, range: 120, offset: 0 }), true);
  assert.equal(wantsOlder({ fitAll: false, total: 1000, range: 100, offset: 890 }), true, "panned to the edge");
  assert.equal(wantsOlder({ fitAll: false, total: 1000, range: 100, offset: 0 }), false);
});

test("older history is asked for two windows ahead, so a page lands before the reader reaches it", () => {
  // 1000 bars loaded, 100 shown: 200 bars left of the window is inside the lead, 201 is not.
  assert.equal(olderLead(100), 200);
  assert.equal(wantsOlder({ fitAll: false, total: 1000, range: 100, offset: 700 }), true);
  assert.equal(wantsOlder({ fitAll: false, total: 1000, range: 100, offset: 699 }), false);
  // A narrow window still leads by at least 120 bars.
  assert.equal(olderLead(20), 120);
  assert.equal(wantsOlder({ fitAll: false, total: 1000, range: 20, offset: 860 }), true);
  assert.equal(wantsOlder({ fitAll: false, total: 1000, range: 20, offset: 859 }), false);
});
