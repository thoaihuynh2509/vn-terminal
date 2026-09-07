import test from "node:test";
import assert from "node:assert/strict";
import { POLL_INTERVAL_MS, applyUpdate, pollStream, type BarUpdate } from "./stream.ts";
import type { Bar } from "../types.ts";

const DAY = 86_400;
const bar = (t: number, o: number, h: number, l: number, c: number, v = 10): Bar => ({ t, o, h, l, c, v });
const up = (b: Bar, final = false): BarUpdate => ({ symbol: "VNM", tf: "1D", bar: b, final });

test("an update inside the current bucket replaces the forming bar", () => {
  const bars = [bar(0, 10, 11, 9, 10), bar(DAY, 10, 12, 10, 11)];
  const out = applyUpdate(bars, up(bar(DAY + 3600, 10, 11, 10, 11.5)), DAY);
  assert.equal(out.length, 2);
  assert.equal(out[1].c, 11.5);
});

test("a forming bar keeps the extremes it has already printed", () => {
  // A poll only sees the price NOW, so trusting its high and low would erase a
  // spike that happened between two polls.
  const bars = [bar(DAY, 10, 20, 5, 11)];
  const out = applyUpdate(bars, up(bar(DAY + 60, 11, 12, 11, 12)), DAY);
  assert.equal(out[0].h, 20, "the earlier high must survive");
  assert.equal(out[0].l, 5, "and the earlier low");
  assert.equal(out[0].o, 10, "the open belongs to the bar, not the poll");
  assert.equal(out[0].c, 12);
});

test("a close beyond the known range extends it", () => {
  const out = applyUpdate([bar(DAY, 10, 12, 9, 11)], up(bar(DAY + 60, 11, 11, 11, 30)), DAY);
  assert.equal(out[0].h, 30);
});

test("a new bucket appends rather than replacing", () => {
  const bars = [bar(0, 10, 11, 9, 10)];
  const out = applyUpdate(bars, up(bar(DAY, 10, 11, 10, 11)), DAY);
  assert.equal(out.length, 2);
  assert.equal(out[1].t, DAY);
});

test("a stale response is ignored rather than moving the chart backwards", () => {
  // Polling does return an older response after a fresher one when a slow
  // request that started earlier finishes later.
  const bars = [bar(0, 1, 1, 1, 1), bar(DAY, 2, 2, 2, 2), bar(2 * DAY, 3, 3, 3, 3)];
  assert.equal(applyUpdate(bars, up(bar(DAY, 9, 9, 9, 9)), DAY), bars);
});

test("a nonsense timestamp is ignored", () => {
  const bars = [bar(DAY, 1, 1, 1, 1)];
  assert.equal(applyUpdate(bars, up(bar(NaN, 1, 1, 1, 1)), DAY), bars);
  assert.equal(applyUpdate(bars, up(bar(-5, 1, 1, 1, 1)), DAY), bars);
});

test("an update into an empty chart seeds it", () => {
  assert.deepEqual(applyUpdate([], up(bar(DAY, 1, 1, 1, 1)), DAY), [bar(DAY, 1, 1, 1, 1)]);
});

test("volume never goes backwards within a bar", () => {
  const out = applyUpdate([bar(DAY, 1, 1, 1, 1, 500)], up(bar(DAY + 60, 1, 1, 1, 1, 100)), DAY);
  assert.equal(out[0].v, 500);
});

test("the fold does not mutate what it was given", () => {
  const bars = [bar(DAY, 10, 11, 9, 10)];
  const before = JSON.stringify(bars);
  applyUpdate(bars, up(bar(DAY + 60, 1, 1, 1, 99)), DAY);
  assert.equal(JSON.stringify(bars), before);
});

test("the polling adapter calls itself delayed, not realtime", () => {
  // A 30-second poll of an end-of-minute feed is not realtime, and a badge
  // saying otherwise is the kind of promise this codebase keeps deleting.
  const s = pollStream(async () => []);
  assert.equal(s.latency, "delayed");
  assert.equal(s.kind, "poll");
});

test("subscribing fetches immediately rather than waiting a full interval", async () => {
  let calls = 0;
  const s = pollStream(async () => { calls++; return [bar(DAY, 1, 1, 1, 1)]; });
  const stop = s.subscribe("VNM", "1D", () => {});
  await new Promise((r) => setTimeout(r, 20));
  stop();
  assert.equal(calls, 1);
});

test("an update reaches the subscriber", async () => {
  const seen: BarUpdate[] = [];
  const s = pollStream(async () => [bar(DAY, 1, 2, 0, 1.5)]);
  const stop = s.subscribe("VNM", "1D", (u) => seen.push(u));
  await new Promise((r) => setTimeout(r, 20));
  stop();
  assert.equal(seen.length, 1);
  assert.equal(seen[0].bar.c, 1.5);
});

test("a closed market is not polled at all", async () => {
  let calls = 0;
  const s = pollStream(async () => { calls++; return []; }, { isOpen: () => false });
  const stop = s.subscribe("VNM", "1D", () => {});
  await new Promise((r) => setTimeout(r, 20));
  stop();
  assert.equal(calls, 0);
});

test("a failed poll is a missed tick, not an error", async () => {
  const s = pollStream(async () => { throw new Error("offline"); });
  const stop = s.subscribe("VNM", "1D", () => { throw new Error("must not be called"); });
  await new Promise((r) => setTimeout(r, 20));
  stop();
});

test("unsubscribing stops the polling", async () => {
  let calls = 0;
  const s = pollStream(async () => { calls++; return []; }, { intervalMs: 5 });
  const stop = s.subscribe("VNM", "1D", () => {});
  await new Promise((r) => setTimeout(r, 20));
  stop();
  const after = calls;
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(calls, after, "no polls after unsubscribe");
});

test("the default interval is stated, not scattered", () => {
  assert.equal(POLL_INTERVAL_MS, 30_000);
});
