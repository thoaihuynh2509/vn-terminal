/**
 * Trading days, in the only timezone this site's dates mean anything in.
 *
 * Every date the archive publishes is a Ho Chi Minh City calendar day. A cron
 * that fires at 08:15 UTC is already 15:15 the same afternoon in ICT, but one
 * run a few hours either side of midnight UTC would land on a different date
 * entirely if the server's clock decided — which is how an archive ends up with
 * two URLs for one session, or none.
 *
 * Pure: the instant is always passed in.
 */
const ICT = "Asia/Ho_Chi_Minh";

/** `YYYY-MM-DD` for the ICT calendar day containing `atMs`. */
export function tradingDay(atMs: number): string {
  // en-CA is ISO-shaped (2026-09-10), which is why it is used here and in the
  // foreign-flow alignment rather than assembling parts by hand.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ICT,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(atMs));
}

/**
 * A `YYYY-MM-DD` string if it is a real weekday date, otherwise null.
 *
 * This is the archive's URL validator, so it decides what 404s. Three refusals,
 * each one a URL that must never render:
 *
 * - Anything not exactly `YYYY-MM-DD`, so no path segment reaches the database.
 * - A date that does not exist (2026-02-30), which `new Date` would silently
 *   roll forward into a page claiming to be a day it is not.
 * - A Saturday or Sunday. HOSE does not trade, so no brief was ever composed,
 *   and a weekend URL in a sitemap is crawl budget spent to reach a 404.
 *
 * Exchange holidays are NOT filtered — the calendar moves every year and a
 * hardcoded list would go stale silently. A holiday simply has no stored row,
 * which the page already treats as not found.
 */
export function parseDay(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;

  const at = new Date(Date.UTC(y, m - 1, d));
  // Round-tripping catches the dates that do not exist: Date.UTC(2026, 1, 30)
  // is 2026-03-02, which would otherwise publish under the date it never was.
  if (at.getUTCFullYear() !== y || at.getUTCMonth() !== m - 1 || at.getUTCDate() !== d) return null;

  const weekday = at.getUTCDay();
  if (weekday === 0 || weekday === 6) return null;

  return value;
}

/** Whether an ICT instant is a weekday, i.e. a day the archive can hold. */
export function isTradingDay(atMs: number): boolean {
  return parseDay(tradingDay(atMs)) !== null;
}
