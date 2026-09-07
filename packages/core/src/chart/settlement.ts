/**
 * When shares you just bought actually become sellable.
 *
 * Vietnam settles T+2, and securities are credited around 13:00 on the second
 * trading day — hence "T+2.5" in local usage. Until then the shares are yours on
 * paper and untouchable in practice, which is why a VN holder marking an entry
 * cares about a date no global charting tool models.
 *
 * Pure. The exchange calendar is data below, and it is the part that rots: it
 * has to be extended every year, and Tet moves with the lunar calendar.
 */
const ICT_OFFSET_MS = 7 * 3600 * 1000;
const DAY_MS = 86_400_000;
/** Securities land in the account after the lunch break on T+2. */
export const SETTLEMENT_HOUR_ICT = 13;

/**
 * Exchange holidays, ISO `YYYY-MM-DD` in exchange local time.
 *
 * ONLY the statutory fixed-date closures are listed. Tet is deliberately absent:
 * it moves with the lunar calendar, the exchange publishes its dates each year,
 * and a guessed Tet would shift every settlement marker in the busiest week of
 * the year by days. A missing holiday makes the marker one session early, which
 * a trader will notice; a wrong one is worse, so this errs toward listing less.
 */
export const VN_HOLIDAYS: readonly string[] = [
  // New Year
  "2025-01-01", "2026-01-01", "2027-01-01",
  // Hung Kings, Reunification, Labour — the fixed-date national holidays
  "2025-04-07", "2025-04-30", "2025-05-01", "2025-09-02",
  "2026-04-26", "2026-04-30", "2026-05-01", "2026-09-02",
];

/**
 * The calendar above is complete only through this date. Past it the
 * calculation still runs — weekends are always right — but a holiday it does
 * not know about will make the marker one session early.
 */
export const CALENDAR_VERIFIED_THROUGH = "2026-12-31";

function ictParts(ms: number) {
  const d = new Date(ms + ICT_OFFSET_MS);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), day: d.getUTCDate(), dow: d.getUTCDay() };
}

/** `YYYY-MM-DD` in exchange local time. */
export function ictDate(ms: number): string {
  const { y, m, day } = ictParts(ms);
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function isTradingDay(ms: number, holidays: readonly string[] = VN_HOLIDAYS): boolean {
  const { dow } = ictParts(ms);
  if (dow === 0 || dow === 6) return false;
  return !holidays.includes(ictDate(ms));
}

/**
 * The instant shares bought at `tradeSec` become sellable: 13:00 local on the
 * second TRADING day after the trade.
 *
 * Counting trading days rather than calendar days is the whole point — a Friday
 * purchase settles Tuesday, and one before a holiday settles a day later still.
 * A trade placed on a non-trading day (a backdated marker, a bad timestamp) is
 * counted from the next trading day rather than rejected.
 */
export function settlementDate(tradeSec: number, holidays: readonly string[] = VN_HOLIDAYS): number {
  let ms = tradeSec * 1000;
  // Normalise to the trade's own local midnight so the hour of purchase cannot
  // push the count across a day boundary.
  const { y, m, day } = ictParts(ms);
  ms = Date.UTC(y, m, day) - ICT_OFFSET_MS;

  while (!isTradingDay(ms, holidays)) ms += DAY_MS;

  let counted = 0;
  while (counted < 2) {
    ms += DAY_MS;
    if (isTradingDay(ms, holidays)) counted += 1;
  }

  const s = ictParts(ms);
  return Math.floor((Date.UTC(s.y, s.m, s.day, SETTLEMENT_HOUR_ICT) - ICT_OFFSET_MS) / 1000);
}

/** Has settlement passed — i.e. can these shares be sold yet? */
export function isSettled(tradeSec: number, nowSec: number, holidays: readonly string[] = VN_HOLIDAYS): boolean {
  return nowSec >= settlementDate(tradeSec, holidays);
}

/** Unrealised move from an entry, in percent. Signed. */
export function unrealisedPct(entry: number, current: number): number {
  if (!Number.isFinite(entry) || entry <= 0 || !Number.isFinite(current)) return 0;
  return ((current - entry) / entry) * 100;
}
