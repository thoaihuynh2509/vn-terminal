import test from "node:test";
import assert from "node:assert/strict";
import { EVENT_GLYPH, ictDay, parseEvents, placeEvents, type RawEvent } from "./events.ts";

/** A unix second at 10:00 ICT on the given local date. */
const at = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return Math.floor((Date.UTC(y, m - 1, d, 10) - 7 * 3600 * 1000) / 1000);
};

/** Shape taken verbatim from a live VNDirect finfo v4 response. */
const vnmCash = (locale: string): RawEvent => ({
  code: "VNM", type: "DIVIDEND", group: "investorRight", locale,
  note: locale === "VN" ? "Trả cổ tức đợt 2/2025 (1850 đ/cp)" : "Second Dividend payment 2025",
  dividend: 1850, ratio: 18.5, effectiveDate: "2026-06-26",
});

test("the same event published in two locales collapses to one marker", () => {
  // The feed mirrors every row per locale; drawn naively, each dividend lands
  // on the chart twice.
  const out = parseEvents([vnmCash("VN"), vnmCash("EN_GB")], "vi");
  assert.equal(out.length, 1);
});

test("the kept row is the one in the reader's language", () => {
  const vi = parseEvents([vnmCash("EN_GB"), vnmCash("VN")], "vi");
  assert.match(vi[0].note, /Trả cổ tức/);
  const en = parseEvents([vnmCash("VN"), vnmCash("EN_GB")], "en");
  assert.match(en[0].note, /Second Dividend/);
});

test("a row order that puts the wanted locale first still keeps it", () => {
  const vi = parseEvents([vnmCash("VN"), vnmCash("EN_GB")], "vi");
  assert.match(vi[0].note, /Trả cổ tức/);
});

test("cash amount and ratio survive parsing", () => {
  const [ev] = parseEvents([vnmCash("VN")], "vi");
  assert.equal(ev.cash, 1850);
  assert.equal(ev.ratio, 18.5);
  assert.equal(ev.kind, "cash");
});

test("stock dividends and rights issues are their own kinds", () => {
  const rows: RawEvent[] = [
    { type: "STOCKDIV", effectiveDate: "2026-01-05", ratio: 10, locale: "VN" },
    { type: "ISSUE", effectiveDate: "2026-02-05", ratio: 5, locale: "VN" },
  ];
  const out = parseEvents(rows, "vi");
  assert.deepEqual(out.map((e) => e.kind), ["stock", "rights"]);
});

test("scheduled (expected) dividends are never drawn", () => {
  // `schedDiv` is the feed's forecast. A marker is a statement of fact.
  const out = parseEvents([{ type: "schedDiv", effectiveDate: "2026-05-05", dividend: 700, locale: "VN" }], "vi");
  assert.deepEqual(out, []);
});

test("meetings, listings and alerts are not share events", () => {
  const rows: RawEvent[] = [
    { type: "MEETING", effectiveDate: "2026-04-25", locale: "VN" },
    { type: "meetingRight", effectiveDate: "2026-04-25", locale: "VN" },
    { type: "LISTED", effectiveDate: "2026-02-27", locale: "VN" },
    { type: "alert", effectiveDate: "2026-02-27", locale: "VN" },
  ];
  assert.deepEqual(parseEvents(rows, "vi"), []);
});

test("a row with no usable ex-date is dropped, not defaulted", () => {
  const rows: RawEvent[] = [
    { type: "DIVIDEND", dividend: 100, locale: "VN" },
    { type: "DIVIDEND", effectiveDate: "not-a-date", dividend: 100, locale: "VN" },
    { type: "DIVIDEND", effectiveDate: "2026-06-26", dividend: 100, locale: "VN" },
  ];
  assert.equal(parseEvents(rows, "vi").length, 1);
});

test("events come back in date order", () => {
  const rows: RawEvent[] = [
    { type: "DIVIDEND", effectiveDate: "2026-06-26", dividend: 1, locale: "VN" },
    { type: "DIVIDEND", effectiveDate: "2025-10-16", dividend: 2, locale: "VN" },
    { type: "DIVIDEND", effectiveDate: "2026-01-02", dividend: 3, locale: "VN" },
  ];
  assert.deepEqual(parseEvents(rows, "vi").map((e) => e.exDate), ["2025-10-16", "2026-01-02", "2026-06-26"]);
});

test("an empty or malformed page yields nothing rather than throwing", () => {
  assert.deepEqual(parseEvents([], "vi"), []);
  assert.deepEqual(parseEvents(undefined as unknown as RawEvent[], "vi"), []);
});

test("bar days are read in exchange time, not UTC", () => {
  // A bar stamped late in the ICT day is still that day; reading it as UTC
  // would shift the marker onto the previous session.
  const [y, m, d] = [2026, 6, 26];
  const lateIct = Math.floor((Date.UTC(y, m - 1, d, 14, 45) - 7 * 3600 * 1000) / 1000);
  assert.equal(ictDay(lateIct), "2026-06-26");
});

test("a marker is placed on the bar whose day is the ex-date", () => {
  const bars = ["2026-06-24", "2026-06-25", "2026-06-26", "2026-06-29"].map((d) => ({ t: at(d) }));
  const placed = placeEvents(bars, parseEvents([vnmCash("VN")], "vi"));
  assert.equal(placed.length, 1);
  assert.equal(placed[0].i, 2);
});

test("an event outside the visible window is dropped, never snapped to an edge", () => {
  // Snapping would park a dividend from another month on the first candle,
  // which reads as a real event on the wrong day.
  const bars = ["2026-07-01", "2026-07-02"].map((d) => ({ t: at(d) }));
  assert.deepEqual(placeEvents(bars, parseEvents([vnmCash("VN")], "vi")), []);
});

test("an ex-date that fell on a non-trading day draws nothing", () => {
  // 2026-06-27 is a Saturday: no bar, so no marker.
  const bars = ["2026-06-26", "2026-06-29"].map((d) => ({ t: at(d) }));
  const rows: RawEvent[] = [{ type: "DIVIDEND", effectiveDate: "2026-06-27", dividend: 500, locale: "VN" }];
  assert.deepEqual(placeEvents(bars, parseEvents(rows, "vi")), []);
});

test("placement is safe on empty inputs", () => {
  assert.deepEqual(placeEvents([], parseEvents([vnmCash("VN")], "vi")), []);
  assert.deepEqual(placeEvents([{ t: at("2026-06-26") }], []), []);
});

test("every kind has a distinct glyph so colour is never the signal", () => {
  const glyphs = Object.values(EVENT_GLYPH);
  assert.equal(new Set(glyphs).size, glyphs.length);
});
