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

/** Gold series we record, in the order the gold page lists them. */
export const GOLD_SERIES = ["SJC", "BTSJC", "BT9999NTT", "DOJINHTV", "PNJ", "XAUUSD"] as const;
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

/** Crypto is charted from the coin feed, addressed the same way gold is. */
export const CRYPTO_PREFIX = "CRYPTO";

/** CoinGecko ids are lowercase, hyphenated: `bitcoin`, `binance-coin`. */
const COIN_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function cryptoSymbol(id: string): string {
  return `${CRYPTO_PREFIX}:${id.toLowerCase()}`;
}

export function cryptoId(symbol: string): string | null {
  const s = symbol.trim();
  if (!s.toUpperCase().startsWith(`${CRYPTO_PREFIX}:`)) return null;
  const id = s.slice(CRYPTO_PREFIX.length + 1).toLowerCase();
  return COIN_RE.test(id) ? id : null;
}

export type ChartSource =
  | { kind: "recorded"; code: string }
  | { kind: "crypto"; id: string }
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
  const id = cryptoId(symbol);
  if (id) return { kind: "crypto", id };
  return { kind: "equity", symbol: symbol.trim().toUpperCase() };
}
