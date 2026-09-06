/**
 * SSI FastConnect Data (FCData) — foreign net buy/sell (khối ngoại).
 *
 * The OFFICIAL, keyed source, so this is legally clean unlike scraping. Auth is
 * a ConsumerID/Secret exchanged for a bearer token (cached ~7h); data comes from
 * `Market/DailyStockPrice`, which carries the per-session foreign totals.
 *
 * Fails closed: with no credentials `ssiConfig()` is null and every call returns
 * empty, so the chart simply omits the overlay — never a fake zero.
 *
 * ⚠️ The response field names below follow SSI's published FCData schema. I could
 * not hit the live API here (no credentials), so on the FIRST deploy with real
 * keys, confirm `TradingDate` / `ForeignBuyVolTotal` etc. against an actual
 * response and adjust `parseForeign` if SSI has renamed a field. `numOf` already
 * tolerates string/number and thousands separators.
 */
import { cached } from "../cache.ts";

const FCDATA = process.env.SSI_FCDATA_URL || "https://fc-data.ssi.com.vn/api/v2/Market";

export interface SsiConfig {
  consumerId: string;
  consumerSecret: string;
}

export function ssiConfig(): SsiConfig | null {
  const consumerId = process.env.SSI_CONSUMER_ID;
  const consumerSecret = process.env.SSI_CONSUMER_SECRET;
  if (!consumerId || !consumerSecret) return null;
  return { consumerId, consumerSecret };
}

export function foreignFlowAvailable(): boolean {
  return ssiConfig() !== null;
}

export interface ForeignDay {
  /** yyyy-mm-dd, so it aligns to a chart bar by trading day, not by exact epoch. */
  date: string;
  /** Foreign buy − sell, in shares and in VND. */
  netVol: number;
  netVal: number;
}

interface DailyRow {
  TradingDate?: string; // dd/MM/yyyy
  ForeignBuyVolTotal?: number | string;
  ForeignSellVolTotal?: number | string;
  ForeignBuyValTotal?: number | string;
  ForeignSellValTotal?: number | string;
}

const numOf = (v: unknown): number => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
};

/** dd/MM/yyyy → yyyy-mm-dd; passes anything else through unchanged. */
function isoDate(d: string): string {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(d.trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : d.trim();
}

/** Pure: SSI DailyStockPrice rows → ascending ForeignDay[]. Unit-tested. */
export function parseForeign(rows: DailyRow[]): ForeignDay[] {
  return rows
    .filter((r) => r.TradingDate)
    .map((r) => ({
      date: isoDate(r.TradingDate!),
      netVol: numOf(r.ForeignBuyVolTotal) - numOf(r.ForeignSellVolTotal),
      netVal: numOf(r.ForeignBuyValTotal) - numOf(r.ForeignSellValTotal),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 8000);
  try {
    const res = await fetch(url, {
      method: "POST",
      signal: ac.signal,
      cache: "no-store",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`ssi: AccessToken HTTP ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

async function accessToken(cfg: SsiConfig): Promise<string> {
  // Tokens last hours; cache so a chart view is one data call, not two.
  return cached("ssi:token", 7 * 3600_000, async () => {
    const r = await postJson<{ data?: { accessToken?: string }; accessToken?: string }>(
      `${FCDATA}/AccessToken`,
      { consumerID: cfg.consumerId, consumerSecret: cfg.consumerSecret },
    );
    const tok = r?.data?.accessToken ?? r?.accessToken;
    if (!tok) throw new Error("ssi: no access token in response");
    return tok;
  });
}

const ddmmyyyy = (d: Date) =>
  `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;

/** Daily foreign net for a symbol. Empty when unconfigured or on any feed error. */
export async function getForeignFlow(symbol: string, days = 250): Promise<ForeignDay[]> {
  const cfg = ssiConfig();
  if (!cfg) return [];
  const sym = symbol.toUpperCase();
  return cached(`ssi:foreign:${sym}:${days}`, 60_000, async () => {
    const token = await accessToken(cfg);
    const to = new Date();
    const from = new Date(to.getTime() - days * 86_400_000);
    const url =
      `${FCDATA}/DailyStockPrice?Symbol=${encodeURIComponent(sym)}` +
      `&FromDate=${ddmmyyyy(from)}&ToDate=${ddmmyyyy(to)}&PageIndex=1&PageSize=1000`;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 8000);
    try {
      const res = await fetch(url, {
        signal: ac.signal,
        cache: "no-store",
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      });
      if (!res.ok) throw new Error(`ssi: DailyStockPrice HTTP ${res.status}`);
      const j = (await res.json()) as { data?: DailyRow[] };
      return parseForeign(Array.isArray(j?.data) ? j.data : []);
    } finally {
      clearTimeout(timer);
    }
  });
}
