/**
 * Prices we record ourselves, addressed as chart symbols.
 *
 * Gold is the first and the reason this exists. The upstream publishes a live
 * snapshot and no history at all, so a gold chart can only ever show what we
 * have recorded — which means the history starts on the day the cron first runs
 * and the UI has to say so rather than imply years of data.
 *
 * A recorded series is addressed as `GOLD:SJC`, so the existing chart route,
 * the bars API and the alerts path all take it as just another symbol instead of
 * needing a parallel set of screens.
 *
 * Pure: the naming rules are testable and are the same on both sides of the API.
 */
export const SERIES_PREFIX = "GOLD";

/**
 * Gold series offered as charts.
 *
 * These are the codes the upstream ACTUALLY publishes, verified against
 * vang.today on 2026-09-08: XAUUSD, BTSJC, BT9999NTT, DOHNL, DOHCML,
 * VIETTINMSJC, PQHNVM, PQHN24NTT, SJ9999, SJL1L10, DOJINHTV, VNGSJC.
 *
 * An earlier version of this list contained `SJC` and `PNJ`, taken from the
 * display-name map in the gold provider rather than from the feed — neither
 * exists, so both silently recorded nothing. `HEADLINE_PRIORITY` in that same
 * provider had the real codes all along; this now agrees with it.
 *
 * This list decides what is LINKED as a chart. It does not decide what is
 * recorded: see `recordGoldSeries`, which stores every code the feed returns,
 * because a day of gold history missed is a day that cannot be recovered.
 */
export const GOLD_SERIES = [
  "SJL1L10", "SJ9999", "BTSJC", "BT9999NTT", "DOHCML", "DOHNL", "DOJINHTV", "PQHNVM", "XAUUSD",
] as const;
export type GoldSeries = (typeof GOLD_SERIES)[number];

/** Codes are upper-case alphanumerics; anything else is not one of ours. */
const CODE_RE = /^[A-Z0-9]{1,32}$/;

/** `GOLD:SJC` for a stored code. */
export function seriesSymbol(code: string): string {
  return `${SERIES_PREFIX}:${code.toUpperCase()}`;
}

/**
 * The stored code behind a chart symbol, or `null` when it is not a recorded
 * series at all — which is how the bars route tells "chart our own data" from
 * "chart an equity" without a second parameter that could disagree with the
 * symbol.
 */
export function seriesCode(symbol: string): string | null {
  const s = symbol.trim().toUpperCase();
  if (!s.startsWith(`${SERIES_PREFIX}:`)) return null;
  const code = s.slice(SERIES_PREFIX.length + 1);
  return CODE_RE.test(code) ? code : null;
}

export function isSeriesSymbol(symbol: string): boolean {
  return seriesCode(symbol) !== null;
}

/** The database key for a code. Kept separate so storage can diverge from display. */
export function seriesKey(code: string): string {
  return `${SERIES_PREFIX.toLowerCase()}:${code.toUpperCase()}`;
}

/**
 * The instant a daily point is recorded against: midnight of the trading day in
 * exchange local time.
 *
 * Bucketing to the DAY is what makes the cron idempotent — a re-run, or a
 * second run after a failure, updates the day's row instead of appending a
 * second point a few minutes later and putting two bars on one day.
 */
export function dayBucket(atMs: number): number {
  const ICT = 7 * 3600 * 1000;
  const shifted = atMs + ICT;
  return Math.floor(Math.floor(shifted / 86_400_000) * 86_400_000 - ICT) / 1000;
}

export type ChartSource =
  | { kind: "recorded"; code: string }
  | { kind: "equity"; symbol: string };

/**
 * Where a chart symbol's bars come from.
 *
 * One decision point, derived from the SYMBOL alone, so the page, the bars API
 * and anything else that charts cannot disagree about what they are looking at.
 * A separate `kind` parameter would be a second source of truth that a hand-typed
 * URL could put out of step with the symbol.
 */
export function chartSource(symbol: string): ChartSource {
  const code = seriesCode(symbol);
  if (code) return { kind: "recorded", code };
  return { kind: "equity", symbol: symbol.trim().toUpperCase() };
}
