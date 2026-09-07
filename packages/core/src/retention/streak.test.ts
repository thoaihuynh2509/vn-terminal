import test from "node:test";
import assert from "node:assert/strict";
import { bumpStreak, ictDay, parseStreak } from "./streak.ts";

const at = (iso: string) => new Date(iso);

test("a first visit starts a streak of one", () => {
  assert.deepEqual(bumpStreak(null, at("2026-09-07T03:00:00Z")), { lastDay: "2026-09-07", count: 1 });
});

test("a second visit the same day is not a second day", () => {
  const first = bumpStreak(null, at("2026-09-07T03:00:00Z"));
  const again = bumpStreak(first, at("2026-09-07T09:00:00Z"));
  assert.equal(again, first, "the identical object lets the caller skip a write");
});

test("consecutive days extend the run", () => {
  let s = bumpStreak(null, at("2026-09-07T03:00:00Z"));
  s = bumpStreak(s, at("2026-09-08T03:00:00Z"));
  s = bumpStreak(s, at("2026-09-09T03:00:00Z"));
  assert.deepEqual(s, { lastDay: "2026-09-09", count: 3 });
});

test("a missed day starts over", () => {
  const s = bumpStreak({ lastDay: "2026-09-07", count: 9 }, at("2026-09-09T03:00:00Z"));
  assert.deepEqual(s, { lastDay: "2026-09-09", count: 1 });
});

test("the day is the market's, so late night and early morning differ", () => {
  // 23:30 in Hanoi on the 7th is 16:30 UTC; 00:30 on the 8th is 17:30 UTC.
  assert.equal(ictDay(at("2026-09-07T16:30:00Z")), "2026-09-07");
  assert.equal(ictDay(at("2026-09-07T17:30:00Z")), "2026-09-08");
  const s = bumpStreak({ lastDay: "2026-09-07", count: 2 }, at("2026-09-07T17:30:00Z"));
  assert.equal(s.count, 3, "crossing local midnight extends rather than breaking");
});

test("a run survives a month boundary", () => {
  const s = bumpStreak({ lastDay: "2026-08-31", count: 4 }, at("2026-09-01T03:00:00Z"));
  assert.deepEqual(s, { lastDay: "2026-09-01", count: 5 });
});

test("a corrupt stored streak restarts instead of throwing", () => {
  for (const bad of [{ lastDay: "nonsense", count: 3 }, { lastDay: "2026-09-06", count: 0 }]) {
    assert.equal(bumpStreak(bad as never, at("2026-09-07T03:00:00Z")).count, 1);
  }
  assert.equal(parseStreak("{"), null);
  assert.equal(parseStreak(null), null);
  assert.equal(parseStreak('{"lastDay":1,"count":"x"}'), null);
});

test("a stored streak round-trips", () => {
  const s = { lastDay: "2026-09-07", count: 5 };
  assert.deepEqual(parseStreak(JSON.stringify(s)), s);
});
