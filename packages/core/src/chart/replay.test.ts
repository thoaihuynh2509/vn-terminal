import { test } from "node:test";
import assert from "node:assert/strict";
import { isReplayDone, replayBars, replayIndex, startReplay, stepReplay } from "./replay.ts";

const bars = [10, 20, 30, 40, 50].map((t) => ({ t }));
const last = <T>(a: T[]) => a[a.length - 1];

test("a replay starts at the chosen bar and hides everything after it", () => {
  const r = startReplay(bars, 30)!;
  assert.deepEqual(replayBars(bars, r).map((b) => b.t), [10, 20, 30]);
  assert.equal(r.playing, false);
});

test("a replay always leaves one bar to play, and needs two to exist", () => {
  assert.equal(startReplay(bars, 999)!.t, 40);
  assert.equal(startReplay(bars.slice(0, 1), 10), null);
});

test("stepping moves one bar and stops playing at the newest", () => {
  let r = { ...startReplay(bars, 40)!, playing: true };
  r = stepReplay(r, bars);
  assert.equal(r.t, 50);
  assert.equal(r.playing, false);
  assert.ok(isReplayDone(r, bars));
  assert.equal(stepReplay(r, bars).t, 50);
});

test("history paged in underneath does not move the replay", () => {
  const r = startReplay(bars, 30)!;
  assert.equal(last(replayBars([{ t: 0 }, { t: 5 }, ...bars], r)).t, 30);
});

test("a time between bars resolves to the bar before it", () => {
  assert.equal(replayIndex(bars, 35), 2);
  assert.equal(replayIndex(bars, 1), 0);
});

test("no replay shows every bar", () => {
  assert.equal(replayBars(bars, null), bars);
});
