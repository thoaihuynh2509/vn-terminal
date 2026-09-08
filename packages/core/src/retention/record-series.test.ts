import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileDb } from "../db/file.ts";
import { pointFor, recordGoldSeries } from "./record-series.ts";
import { dayBucket, seriesKey } from "../chart/series.ts";
import type { GoldSnapshot } from "../types.ts";

const db = () => mkdtemp(join(tmpdir(), "vnt-series-")).then(createFileDb);

const row = (code: string, buy: number, sell: number) =>
  ({ code, name: code, buy, sell, changeBuy: 0, changeSell: 0, currency: "VND" as const });

const snap = (rows: ReturnType<typeof row>[], world?: ReturnType<typeof row>): GoldSnapshot =>
  ({ rows, world, updatedAt: "", date: "" });

test("the recorded point is the MID of bid and ask", () => {
  // A chart of the sell price alone moves whenever the spread widens, which is
  // a dealer's decision rather than a change in the price of gold.
  assert.equal(pointFor(100, 110, 5)?.c, 105);
});

test("one snapshot a day claims no intraday range", () => {
  // All four are the same number: a chart implying a high and low it never
  // observed would be worse than a flat one.
  const p = pointFor(100, 110, 5)!;
  assert.equal(p.o, p.c);
  assert.equal(p.h, p.l);
  assert.equal(p.h, p.c);
});

test("a nonsense quote is not recorded", () => {
  assert.equal(pointFor(0, 0, 5), null);
  assert.equal(pointFor(NaN, 100, 5), null);
  assert.equal(pointFor(-100, -90, 5), null);
});

test("recording writes one point per known series", async () => {
  const d = await db();
  const r = await recordGoldSeries(d, snap([row("BTSJC", 100, 110), row("DOHNL", 90, 100)]), Date.now());
  assert.equal(r.written, 2);
  assert.equal((await d.series.range(seriesKey("BTSJC"), 10))[0].c, 105);
});

test("a curated series the snapshot omits is reported, not silently skipped", async () => {
  // A shrinking upstream should be visible in the job's own output — but only
  // for the codes we actually link as charts.
  const d = await db();
  const r = await recordGoldSeries(d, snap([row("BTSJC", 100, 110)]), Date.now());
  assert.ok(r.missing.includes("SJL1L10"), r.missing.join(","));
  assert.ok(!r.missing.includes("BTSJC"));
  assert.equal(r.written, 1);
});

test("every code the feed returns is recorded, curated or not", async () => {
  // History cannot be backfilled, so an uncurated code is still kept: if it
  // becomes interesting later its chart starts from today, not from that day.
  const d = await db();
  const r = await recordGoldSeries(d, snap([row("BTSJC", 100, 110), row("VNGSJC", 90, 100)]), Date.now());
  assert.equal(r.written, 2);
  assert.equal((await d.series.range(seriesKey("VNGSJC"), 10)).length, 1);
});

test("the world leg is recorded alongside the domestic rows", async () => {
  const d = await db();
  await recordGoldSeries(d, snap([], row("XAUUSD", 2000, 2010)), Date.now());
  assert.equal((await d.series.range(seriesKey("XAUUSD"), 10))[0].c, 2005);
});

test("running twice in one day updates that day rather than adding a bar", async () => {
  // The property that makes the job safe to retry.
  const d = await db();
  const now = Date.UTC(2026, 8, 7, 10);
  await recordGoldSeries(d, snap([row("BTSJC", 100, 110)]), now);
  await recordGoldSeries(d, snap([row("BTSJC", 200, 210)]), now + 3600_000);
  const points = await d.series.range(seriesKey("BTSJC"), 10);
  assert.equal(points.length, 1);
  assert.equal(points[0].c, 205);
});

test("two days produce two points", async () => {
  const d = await db();
  const day1 = Date.UTC(2026, 8, 7, 10);
  await recordGoldSeries(d, snap([row("BTSJC", 100, 110)]), day1);
  await recordGoldSeries(d, snap([row("BTSJC", 120, 130)]), day1 + 86_400_000);
  const points = await d.series.range(seriesKey("BTSJC"), 10);
  assert.equal(points.length, 2);
  assert.deepEqual(points.map((p) => p.c), [105, 125]);
});

test("the point is filed under the trading day, not the wall clock", async () => {
  const d = await db();
  const now = Date.UTC(2026, 8, 7, 10);
  const r = await recordGoldSeries(d, snap([row("BTSJC", 100, 110)]), now);
  assert.equal(r.t, dayBucket(now));
  assert.equal((await d.series.range(seriesKey("BTSJC"), 10))[0].t, dayBucket(now));
});

test("an empty snapshot records nothing and reports everything missing", async () => {
  const d = await db();
  const r = await recordGoldSeries(d, snap([]), Date.now());
  assert.equal(r.written, 0);
  assert.ok(r.missing.length > 0);
});
