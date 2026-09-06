import test from "node:test";
import assert from "node:assert/strict";
import { isSessionOpen, sessionPhase } from "./session.ts";

// ICT is UTC+7, so a UTC instant maps to local time seven hours later.
// 2024-01-08 is a Monday, 2024-01-12 a Friday, 13th Sat, 14th Sun, 7th Sun.
const at = (iso: string) => new Date(iso);

test("the morning session is open", () => {
  assert.equal(sessionPhase(at("2024-01-08T02:30:00Z")), "morning"); // 09:30 ICT
  assert.equal(isSessionOpen(at("2024-01-08T02:30:00Z")), true);
});

test("the lunch break counts as closed — the last price cannot move", () => {
  assert.equal(sessionPhase(at("2024-01-08T05:00:00Z")), "lunch"); // 12:00 ICT
  assert.equal(isSessionOpen(at("2024-01-08T05:00:00Z")), false);
});

test("the afternoon session and the closing auction are open", () => {
  assert.equal(sessionPhase(at("2024-01-08T06:30:00Z")), "afternoon"); // 13:30
  assert.equal(isSessionOpen(at("2024-01-08T06:30:00Z")), true);
  assert.equal(sessionPhase(at("2024-01-08T07:45:00Z")), "atc"); // 14:45
  assert.equal(isSessionOpen(at("2024-01-08T07:45:00Z")), true);
});

test("before the open and after the close are shut", () => {
  assert.equal(sessionPhase(at("2024-01-08T01:00:00Z")), "pre"); // 08:00
  assert.equal(isSessionOpen(at("2024-01-08T01:00:00Z")), false);
  assert.equal(sessionPhase(at("2024-01-08T08:30:00Z")), "post"); // 15:30
  assert.equal(isSessionOpen(at("2024-01-08T08:30:00Z")), false);
});

test("every boundary belongs to the later phase", () => {
  assert.equal(sessionPhase(at("2024-01-08T02:00:00Z")), "morning"); // exactly 09:00
  assert.equal(sessionPhase(at("2024-01-08T04:30:00Z")), "lunch"); //   exactly 11:30
  assert.equal(sessionPhase(at("2024-01-08T06:00:00Z")), "afternoon"); // exactly 13:00
  assert.equal(sessionPhase(at("2024-01-08T07:30:00Z")), "atc"); //     exactly 14:30
  assert.equal(sessionPhase(at("2024-01-08T08:00:00Z")), "post"); //    exactly 15:00
});

test("the weekend is closed all day", () => {
  assert.equal(sessionPhase(at("2024-01-13T05:00:00Z")), "weekend"); // Sat noon ICT
  assert.equal(sessionPhase(at("2024-01-14T05:00:00Z")), "weekend"); // Sun noon ICT
  assert.equal(isSessionOpen(at("2024-01-13T05:00:00Z")), false);
});

// The offset is the whole point of the module: a UTC timestamp late on one day
// is already the next day in Ho Chi Minh City, and the weekday must follow.
test("the weekday is the LOCAL one, not the UTC one", () => {
  // Sunday 18:00 UTC is Monday 01:00 ICT — a weekday, before the open.
  assert.equal(sessionPhase(at("2024-01-07T18:00:00Z")), "pre");
  // Friday 18:00 UTC is Saturday 01:00 ICT — already the weekend.
  assert.equal(sessionPhase(at("2024-01-12T18:00:00Z")), "weekend");
});
