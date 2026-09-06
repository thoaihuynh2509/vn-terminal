/**
 * HOSE trading session clock.
 *
 * The chart auto-refreshes only while prices can actually move. Polling a dead
 * market all evening burns the reader's battery and our upstream quota for a
 * number that cannot change, and an "updating live" dot over a frozen price is a
 * lie — so the refresh seam asks this module first.
 *
 * Vietnam has been UTC+7 with no daylight saving since 1975, so the offset is a
 * constant rather than an Intl lookup: this stays deterministic on any runtime
 * (the same reason `format.ts` forms its digits by hand).
 *
 * Not modelled: exchange holidays. Refreshing on Tet is a wasted request, not a
 * wrong answer, and a holiday table has to be maintained every year — the one in
 * `settlement.ts` exists because T+2.5 arithmetic is wrong without it.
 */
const OFFSET_SEC = 7 * 3600;

/** Minutes past ICT midnight for each boundary of a HOSE day. */
const OPEN = 9 * 60; //        09:00 ATO
const LUNCH_START = 11 * 60 + 30; // 11:30
const LUNCH_END = 13 * 60; //  13:00
const ATC = 14 * 60 + 30; //   14:30 closing auction
const CLOSE = 15 * 60; //      15:00

export type SessionPhase =
  | "weekend"
  | "pre" // before the open
  | "morning" // 09:00–11:30, ATO included
  | "lunch" // 11:30–13:00, prices frozen
  | "afternoon" // 13:00–14:30
  | "atc" // 14:30–15:00, closing auction
  | "post"; // after the close

/** Weekday (0=Sun) and minutes-past-midnight, both in Ho Chi Minh local time. */
function ictParts(at: Date): { day: number; minutes: number } {
  const shifted = new Date(at.getTime() + OFFSET_SEC * 1000);
  return {
    day: shifted.getUTCDay(),
    minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
  };
}

export function sessionPhase(at: Date): SessionPhase {
  const { day, minutes } = ictParts(at);
  if (day === 0 || day === 6) return "weekend";
  if (minutes < OPEN) return "pre";
  if (minutes < LUNCH_START) return "morning";
  if (minutes < LUNCH_END) return "lunch";
  if (minutes < ATC) return "afternoon";
  if (minutes < CLOSE) return "atc";
  return "post";
}

/**
 * True only when a quote can still change — the lunch break counts as closed,
 * because the last price is fixed until 13:00 and refreshing through it buys
 * nothing.
 */
export function isSessionOpen(at: Date): boolean {
  const phase = sessionPhase(at);
  return phase === "morning" || phase === "afternoon" || phase === "atc";
}
