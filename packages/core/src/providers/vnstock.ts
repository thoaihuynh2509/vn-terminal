import { cached, fetchJson } from "../cache";
import { resample, resampleIntraday, resampleMonthly } from "../ta/resample";
import { EXCHANGE_OFFSET, timeframe, type Timeframe } from "../chart/timeframes";
import { FeedError, type Bar, type Quote } from "../types";

/**
 * Vietnamese equity data.
 *
 * Primary feed: DNSE (services.entrade.com.vn) — TradingView-shaped OHLC arrays.
 * Fallback:     VNDirect dchart — same shape, different host.
 * Indices:      CafeF msh-appdata — the only one of the three that publishes a
 *               whole-market snapshot in a single call.
 *
 * TCBS was evaluated and rejected: it sits behind a Cloudflare interstitial.
 */

const DNSE = "https://services.entrade.com.vn/chart-api/v2/ohlcs";
const VNDIRECT = "https://dchart-api.vndirect.com.vn/dchart/history";
const CAFEF = "https://msh-appdata.cafef.vn/rest-api/api/v1/StockMarket?centerId=1";

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
  { days = 120, resolution = "1D", kind = "stock" }: { days?: number; resolution?: Resolution; kind?: Kind } = {},
): Promise<Bar[]> {
  const sym = symbol.toUpperCase();
  const to = Math.floor(Date.now() / 1000);
  // Over-fetch calendar days so `days` trading sessions survive weekends/holidays.
  const from = to - Math.ceil(days * 1.6) * 86400;

  return cached(`bars:${kind}:${sym}:${resolution}:${days}`, 60_000, async () => {
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
  { kind = "stock" }: { kind?: Kind } = {},
): Promise<Bar[]> {
  const t = typeof tf === "string" ? timeframe(tf) : tf;
  const raw = await getBars(symbol, { days: t.lookback, resolution: t.fetch, kind });
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
 * Board snapshot. Symbols are fetched with bounded concurrency: the upstream is
 * a free public endpoint and firing 30 parallel requests at it gets us throttled.
 * A symbol that fails is dropped rather than failing the whole board.
 */
export async function getBoard(symbols: readonly string[] = VN30): Promise<Quote[]> {
  return cached(`board:${symbols.join(",")}`, 60_000, async () => {
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

    if (!out.length) throw new FeedError("vnstock", "board empty — all symbols failed");
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
