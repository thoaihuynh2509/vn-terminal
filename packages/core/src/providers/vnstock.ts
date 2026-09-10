import { cached, fetchJson } from "../cache.ts";
import { resample, resampleIntraday, resampleMonthly } from "../ta/resample.ts";
import { EXCHANGE_OFFSET, timeframe, type Timeframe } from "../chart/timeframes.ts";
import { dayBucket } from "../chart/series.ts";
import { FeedError, type Bar, type Quote } from "../types.ts";

/**
 * Vietnamese equity data.
 *
 * Board:        VPS bgapidatafeed — every requested symbol in ONE request.
 * Bars:         DNSE (services.entrade.com.vn) — TradingView-shaped OHLC arrays.
 * Fallback:     VNDirect dchart — same shape, different host.
 * Indices:      CafeF msh-appdata — a whole-market snapshot in a single call.
 *
 * TCBS was evaluated and rejected: it sits behind a Cloudflare interstitial.
 */

const DNSE = "https://services.entrade.com.vn/chart-api/v2/ohlcs";
const VNDIRECT = "https://dchart-api.vndirect.com.vn/dchart/history";
const CAFEF = "https://msh-appdata.cafef.vn/rest-api/api/v1/StockMarket?centerId=1";
const VPS = "https://bgapidatafeed.vps.com.vn/getliststockdata";

/** What the chart opens on when a URL names no symbol. */
export const DEFAULT_SYMBOL = "VNM";

/** VN30 constituents — the liquid core of HOSE. */
export const VN30 = [
  "ACB", "BCM", "BID", "BVH", "CTG", "FPT", "GAS", "GVR", "HDB", "HPG",
  "MBB", "MSN", "MWG", "PLX", "POW", "SAB", "SHB", "SSB", "SSI", "STB",
  "TCB", "TPB", "VCB", "VHM", "VIB", "VIC", "VJC", "VNM", "VPB", "VRE",
] as const;

/** Daily price-limit bands by exchange, used to flag ceiling/floor closes. */
export const BAND: Record<string, number> = { HOSE: 0.07, HNX: 0.1, UPCOM: 0.15 };

interface OhlcResponse {
  t?: number[]; o?: number[]; h?: number[]; l?: number[]; c?: number[]; v?: number[];
  s?: string;
}

function toBars(r: OhlcResponse): Bar[] {
  if (!r.t?.length || !r.c?.length) return [];
  return r.t.map((t, i) => ({
    t,
    o: r.o?.[i] ?? r.c![i],
    h: r.h?.[i] ?? r.c![i],
    l: r.l?.[i] ?? r.c![i],
    c: r.c![i],
    v: r.v?.[i] ?? 0,
  }));
}

export type Resolution = "1" | "3" | "5" | "15" | "30" | "1D" | "1W";

/** VNDirect names its resolutions differently for the daily and weekly cases. */
function vndirectResolution(r: Resolution): string {
  return r === "1W" ? "W" : r === "1D" ? "D" : r;
}
export type Kind = "stock" | "index";

export async function getBars(
  symbol: string,
  { days = 120, resolution = "1D", kind = "stock", before }: {
    days?: number; resolution?: Resolution; kind?: Kind;
    /** Fetch the window ENDING here, for loading older history. */
    before?: number;
  } = {},
): Promise<Bar[]> {
  const sym = symbol.toUpperCase();
  const to = before && Number.isFinite(before) ? Math.floor(before) : Math.floor(Date.now() / 1000);
  // Over-fetch calendar days so `days` trading sessions survive weekends/holidays.
  const from = to - Math.ceil(days * 1.6) * 86400;

  // A historical window never changes, so it is cached far longer than the
  // live one — the same page re-requested while a reader pans back and forth
  // must not become a request per pan.
  const ttl = before ? 6 * 60 * 60_000 : 60_000;
  return cached(`bars:${kind}:${sym}:${resolution}:${days}:${before ?? 0}`, ttl, async () => {
    try {
      const r = await fetchJson<OhlcResponse>(
        `${DNSE}/${kind}?from=${from}&to=${to}&symbol=${sym}&resolution=${resolution}`,
        { feed: "dnse" },
      );
      const bars = toBars(r);
      if (bars.length) return bars;
      throw new Error("empty series");
    } catch {
      const r = await fetchJson<OhlcResponse>(
        `${VNDIRECT}?symbol=${sym}&resolution=${vndirectResolution(resolution)}&from=${from}&to=${to}`,
        { feed: "vndirect" },
      );
      const bars = toBars(r);
      if (!bars.length) throw new FeedError("vnstock", `no bars for ${sym}`);
      return bars;
    }
  });
}

/**
 * Bars for a chart interval.
 *
 * The feed only answers a handful of native resolutions, so anything else is
 * fetched at the nearest supported one and aggregated here. Aggregation happens
 * on the server: sending a client 1,700 thirty-minute bars so it can fold them
 * into 200 four-hour bars wastes the reader's bandwidth to do work we already
 * have the data for.
 */
export async function getTimeframeBars(
  symbol: string,
  tf: Timeframe | string,
  { kind = "stock", before }: { kind?: Kind; before?: number } = {},
): Promise<Bar[]> {
  const t = typeof tf === "string" ? timeframe(tf) : tf;
  const raw = await getBars(symbol, { days: t.lookback, resolution: t.fetch, kind, before });
  if (t.months) return resampleMonthly(raw, t.months);
  if (!t.bucket) return raw;
  // Buckets shorter than a day restart each session; longer ones tile the epoch.
  return t.bucket < 86400
    ? resampleIntraday(raw, t.bucket, EXCHANGE_OFFSET)
    : resample(raw, t.bucket, EXCHANGE_OFFSET);
}

function quoteFromBars(symbol: string, bars: Bar[]): Quote {
  const last = bars[bars.length - 1];
  const prev = bars[bars.length - 2];
  const prevClose = prev?.c ?? last.o;
  const change = last.c - prevClose;
  return {
    symbol,
    price: last.c,
    change,
    changePct: prevClose ? (change / prevClose) * 100 : 0,
    volume: last.v,
    high: last.h,
    low: last.l,
    open: last.o,
    prevClose,
  };
}

export async function getQuote(symbol: string): Promise<Quote> {
  // 30 sessions rather than 5: the extra history costs the same single request
  // and backs the sparkline column on the board.
  const bars = await getBars(symbol, { days: 30 });
  if (!bars.length) throw new FeedError("vnstock", `no data for ${symbol}`);
  const q = quoteFromBars(symbol.toUpperCase(), bars);
  return { ...q, spark: bars.slice(-20).map((b) => b.c) };
}

/**
 * Index history for the overview tiles. CafeF publishes only a live snapshot,
 * so the series comes from DNSE's index endpoint. Symbols it does not carry are
 * skipped rather than failing the strip.
 */
export async function getIndexSparks(symbols: string[]): Promise<Record<string, number[]>> {
  return cached(`indexsparks:${symbols.join(",")}`, 300_000, async () => {
    const out: Record<string, number[]> = {};
    await Promise.all(
      symbols.map(async (sym) => {
        try {
          const bars = await getBars(sym, { days: 30, kind: "index" });
          if (bars.length > 2) out[sym] = bars.slice(-20).map((b) => b.c);
        } catch {
          // No series for this index; the tile renders without a sparkline.
        }
      }),
    );
    return out;
  });
}

/**
 * One row of the VPS board feed. Only the fields we read are declared; the feed
 * sends ~50 per symbol, most of them order-book depth we have no use for.
 *
 * Three of its conventions are traps, and all three are handled in `quoteFromRow`
 * rather than at the call sites:
 *   - `ot` and `changePc` are UNSIGNED. A stock down 0.20 reports "0.20", so the
 *     direction has to come from `lastPrice` against `r`. Taking them at face
 *     value renders every decliner as a gainer.
 *   - `lot` is in board lots of ten, not shares.
 *   - the numeric fields arrive as strings.
 */
export interface VpsRow {
  sym: string;
  /** Last matched price. Zero before the first match of the session. */
  lastPrice: number;
  /** Reference (previous close). */
  r: number;
  /** Session volume, in lots of ten shares. */
  lot: number;
  openPrice: string;
  highPrice: string;
  lowPrice: string;
}

/**
 * A feed field as a number, or undefined when it is not one.
 *
 * The empty-string guard is load-bearing: `Number("")` is 0, not NaN, so an
 * absent high would otherwise arrive as a high of zero — a real-looking price
 * the board would render and the chart would scale to.
 */
const n = (v: string | number | undefined): number | undefined => {
  if (v === undefined || v === null) return undefined;
  if (typeof v === "string" && v.trim() === "") return undefined;
  const x = Number(v);
  return Number.isFinite(x) ? x : undefined;
};

export function quoteFromRow(row: VpsRow): Quote | null {
  const prevClose = n(row.r);
  // Before the first match the feed sends 0, which is "no trade yet", not a
  // price of zero. Reference is the honest stand-in: the board then shows the
  // symbol flat at yesterday's close rather than down 100%.
  const price = n(row.lastPrice) || prevClose;
  if (!row.sym || !price) return null;
  const change = prevClose === undefined ? 0 : price - prevClose;
  return {
    symbol: row.sym.toUpperCase(),
    price,
    change,
    changePct: prevClose ? (change / prevClose) * 100 : 0,
    volume: n(row.lot) === undefined ? undefined : n(row.lot)! * 10,
    high: n(row.highPrice),
    low: n(row.lowPrice),
    open: n(row.openPrice),
    prevClose,
  };
}

/** The whole board in one request. Symbols the feed does not carry are absent. */
async function snapshotBoard(symbols: readonly string[]): Promise<Quote[]> {
  const rows = await fetchJson<VpsRow[]>(`${VPS}/${symbols.join(",")}`, { feed: "vps" });
  if (!Array.isArray(rows) || !rows.length) throw new FeedError("vps", "empty board");
  return rows.map(quoteFromRow).filter((q): q is Quote => q !== null);
}

/**
 * The old per-symbol path, kept as the fallback.
 *
 * Bounded concurrency because the upstream is a free public endpoint and firing
 * 30 parallel requests at it gets us throttled. A symbol that fails is dropped
 * rather than failing the whole board.
 */
async function fanOutBoard(symbols: readonly string[]): Promise<Quote[]> {
  const out: Quote[] = [];
  const queue = [...symbols];
  const CONCURRENCY = 6;

  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      for (;;) {
        const sym = queue.shift();
        if (!sym) return;
        try {
          out.push(await getQuote(sym));
        } catch {
          // Drop this symbol; a partial board beats an empty page.
        }
      }
    }),
  );
  return out;
}

/**
 * The closes BEFORE today, for the board's trend glyph.
 *
 * Split from the quote because the two go stale on completely different clocks:
 * a price moves every minute, a set of prior daily closes changes once, at the
 * close. Fetching them together is what made the board thirty requests a minute
 * instead of one. Today's point is not included — the caller appends the live
 * price — so a cached set stays correct for the whole session.
 *
 * Keyed by trading day as well as TTL'd: a set cached late in one session must
 * not survive into the next, where it would be missing yesterday's close and
 * silently shift every point by a day.
 */
async function sparkHistory(symbols: readonly string[]): Promise<Map<string, number[]>> {
  const day = dayBucket(Date.now());
  return cached(`sparks:${day}:${symbols.join(",")}`, 6 * 60 * 60_000, async () => {
    const out = new Map<string, number[]>();
    const queue = [...symbols];
    const CONCURRENCY = 6;

    await Promise.all(
      Array.from({ length: CONCURRENCY }, async () => {
        for (;;) {
          const sym = queue.shift();
          if (!sym) return;
          try {
            const bars = await getBars(sym, { days: 30 });
            // Drop the last bar: during a session it is today's unfinished one,
            // and the live price replaces it.
            const closes = bars.slice(-20, -1).map((b) => b.c);
            if (closes.length > 1) out.set(sym.toUpperCase(), closes);
          } catch {
            // No history for this symbol; its row renders without a glyph.
          }
        }
      }),
    );
    return out;
  });
}

/**
 * Board snapshot.
 *
 * One request for every symbol, with the per-symbol fan-out kept behind it: the
 * snapshot feed is a free public endpoint with no SLA, and a board is the page.
 *
 * `spark` is opt-in because only the full board and the chart rail draw the
 * trend glyph — every other caller (the movers, the heatmap, sector rotation,
 * the alert cron, the brief) reads numbers and would otherwise pay for a
 * history fetch it never renders.
 */
export async function getBoard(
  symbols: readonly string[] = VN30,
  { spark = false }: { spark?: boolean } = {},
): Promise<Quote[]> {
  return cached(`board:${spark ? "spark" : "plain"}:${symbols.join(",")}`, 60_000, async () => {
    let out: Quote[];
    try {
      out = await snapshotBoard(symbols);
      if (!out.length) throw new FeedError("vps", "no usable rows");
    } catch {
      out = await fanOutBoard(symbols);
    }
    if (!out.length) throw new FeedError("vnstock", "board empty — all symbols failed");

    if (spark) {
      // Best-effort: a board with no glyphs beats no board.
      const history = await sparkHistory(symbols).catch(() => new Map<string, number[]>());
      out = out.map((q) => {
        if (q.spark?.length) return q; // the fan-out already carries one
        const prior = history.get(q.symbol);
        return prior ? { ...q, spark: [...prior, q.price] } : q;
      });
    }
    return out.sort((a, b) => a.symbol.localeCompare(b.symbol));
  });
}

interface CafefIndex {
  symbol: string; price: number; changePrice: number; changePercentPrice: number;
  volume: number; value: number; referencePrice?: number;
}

/** CafeF labels the HOSE index "HOSE"; every Vietnamese reader calls it VNINDEX. */
const INDEX_LABEL: Record<string, string> = { HOSE: "VNINDEX" };

export async function getIndices(): Promise<Quote[]> {
  return cached("indices", 45_000, async () => {
    const r = await fetchJson<{ data: CafefIndex[] }>(CAFEF, { feed: "cafef" });
    if (!r?.data?.length) throw new FeedError("cafef", "no index rows");
    return r.data.map((i) => ({
      symbol: INDEX_LABEL[i.symbol] ?? i.symbol,
      price: i.price,
      change: i.changePrice,
      changePct: i.changePercentPrice,
      volume: i.volume,
      // CafeF sends referencePrice 0 for indices — that is "missing", not "zero".
      prevClose: i.referencePrice || undefined,
    }));
  });
}
