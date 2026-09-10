import test from "node:test";
import assert from "node:assert/strict";
import { isTradingDay, parseDay, tradingDay } from "./day.ts";

test("the trading day is the Vietnamese calendar day, not the server's", () => {
  // 2026-09-10 16:59 UTC is 23:59 the same day in ICT (UTC+7).
  assert.equal(tradingDay(Date.UTC(2026, 8, 10, 16, 59)), "2026-09-10");
  // One minute later it is already tomorrow in Ho Chi Minh City.
  assert.equal(tradingDay(Date.UTC(2026, 8, 10, 17, 1)), "2026-09-11");
  // And the cron's own slot, 08:15 UTC, is that afternoon.
  assert.equal(tradingDay(Date.UTC(2026, 8, 10, 8, 15)), "2026-09-10");
});

test("a well-formed weekday is accepted unchanged", () => {
  assert.equal(parseDay("2026-09-10"), "2026-09-10"); // Thursday
  assert.equal(parseDay("2026-09-07"), "2026-09-07"); // Monday
  assert.equal(parseDay("2026-09-11"), "2026-09-11"); // Friday
});

test("a weekend has no session, so it has no page", () => {
  assert.equal(parseDay("2026-09-12"), null); // Saturday
  assert.equal(parseDay("2026-09-13"), null); // Sunday
});

test("a date that does not exist is refused rather than rolled forward", () => {
  // new Date(Date.UTC(2026, 1, 30)) is 2026-03-02; publishing that under
  // /ban-tin/2026-02-30 would be a page lying about its own date.
  assert.equal(parseDay("2026-02-30"), null);
  assert.equal(parseDay("2026-13-01"), null);
  assert.equal(parseDay("2026-00-10"), null);
  assert.equal(parseDay("2026-09-00"), null);
  assert.equal(parseDay("2026-09-32"), null);
});

test("a leap day is a real date and survives", () => {
  assert.equal(parseDay("2028-02-29"), "2028-02-29"); // Tuesday
  assert.equal(parseDay("2026-02-29"), null); // not a leap year
});

test("nothing that is not exactly YYYY-MM-DD reaches the database", () => {
  for (const bad of [
    "", "2026-9-10", "26-09-10", "2026/09/10", "2026-09-10T00:00:00Z",
    "2026-09-10 ", " 2026-09-10", "latest", "../../etc/passwd",
    "2026-09-10'; DROP TABLE briefs;--",
  ]) {
    assert.equal(parseDay(bad), null, `accepted ${JSON.stringify(bad)}`);
  }
});

test("isTradingDay reads the ICT calendar, not UTC", () => {
  // Friday 23:30 ICT is still Friday, though it is already Saturday nowhere.
  assert.equal(isTradingDay(Date.UTC(2026, 8, 11, 16, 30)), true);
  // Saturday 00:30 ICT is Friday 17:30 UTC.
  assert.equal(isTradingDay(Date.UTC(2026, 8, 11, 17, 30)), false);
});
