import test from "node:test";
import assert from "node:assert/strict";
import {
  CALENDAR_VERIFIED_THROUGH, SETTLEMENT_HOUR_ICT, ictDate, isSettled, isTradingDay,
  settlementDate, unrealisedPct,
} from "./settlement.ts";

/** A unix second at 10:00 ICT on the given local date. */
const at = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return Math.floor((Date.UTC(y, m - 1, d, 10) - 7 * 3600 * 1000) / 1000);
};
const settlesOn = (iso: string) => ictDate(settlementDate(at(iso)) * 1000);

test("a midweek buy settles two trading days later", () => {
  // Monday 2026-09-07 → Wednesday.
  assert.equal(settlesOn("2026-09-07"), "2026-09-09");
});

test("a Friday buy settles Tuesday, not Sunday", () => {
  // Counting calendar days instead of trading days is the classic version of
  // this bug, and it lands on a day the market is shut.
  assert.equal(settlesOn("2026-09-11"), "2026-09-15");
});

test("a Thursday buy skips the weekend", () => {
  assert.equal(settlesOn("2026-09-10"), "2026-09-14");
});

test("a holiday pushes settlement out another session", () => {
  // 2026-09-02 is National Day. A 2026-09-01 buy cannot settle on the 3rd.
  assert.equal(settlesOn("2026-08-31"), "2026-09-03", "Mon → Thu across the holiday");
});

test("shares land after lunch, not at midnight", () => {
  // The whole reason it is called T+2.5 locally.
  const s = new Date(settlementDate(at("2026-09-07")) * 1000);
  const ictHour = new Date(s.getTime() + 7 * 3600 * 1000).getUTCHours();
  assert.equal(ictHour, SETTLEMENT_HOUR_ICT);
});

test("the hour of purchase does not change the settlement day", () => {
  const [y, m, d] = [2026, 9, 7];
  const early = Math.floor((Date.UTC(y, m - 1, d, 2) - 7 * 3600 * 1000) / 1000);
  const late = Math.floor((Date.UTC(y, m - 1, d, 14) - 7 * 3600 * 1000) / 1000);
  assert.equal(settlementDate(early), settlementDate(late));
});

test("a trade dated on a closed day counts from the next open one", () => {
  // A backdated marker or a bad timestamp must not be rejected outright.
  assert.equal(settlesOn("2026-09-12"), settlesOn("2026-09-14"), "Saturday counts as Monday");
});

test("weekends and listed holidays are not trading days", () => {
  assert.equal(isTradingDay(Date.UTC(2026, 8, 12) - 7 * 3600 * 1000), false, "Saturday");
  assert.equal(isTradingDay(Date.UTC(2026, 8, 13) - 7 * 3600 * 1000), false, "Sunday");
  assert.equal(isTradingDay(Date.UTC(2026, 8, 2) - 7 * 3600 * 1000), false, "National Day");
  assert.equal(isTradingDay(Date.UTC(2026, 8, 7) - 7 * 3600 * 1000), true, "a Monday");
});

test("settlement is a moment, and before it the shares are locked", () => {
  const bought = at("2026-09-07");
  const settles = settlementDate(bought);
  assert.equal(isSettled(bought, settles - 1), false);
  assert.equal(isSettled(bought, settles), true);
});

test("the calendar states how far it is trustworthy", () => {
  // It rots: Tet moves every year and is deliberately not guessed.
  assert.match(CALENDAR_VERIFIED_THROUGH, /^\d{4}-\d{2}-\d{2}$/);
});

test("unrealised move is signed and safe on nonsense input", () => {
  assert.equal(unrealisedPct(100, 110), 10);
  assert.equal(unrealisedPct(100, 90), -10);
  for (const bad of [0, -1, Number.NaN]) assert.equal(unrealisedPct(bad, 100), 0);
});
