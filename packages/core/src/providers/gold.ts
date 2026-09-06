import { cached, fetchJson } from "../cache";
import { FeedError, type GoldRow, type GoldSnapshot } from "../types";

export { GRAMS_PER_LUONG, GRAMS_PER_TROY_OZ, OZ_PER_LUONG, premium } from "../gold-math";

/**
 * Gold. vang.today publishes SJC / DOJI / PNJ / Bao Tin bid-ask per lượng in VND
 * plus XAU/USD in one payload, refreshed roughly every 5 minutes, CORS-open and
 * key-free. api.gold-api.com is the spot-only fallback for the world leg.
 */
const VANG = "https://www.vang.today/api/prices";
const GOLD_API = "https://api.gold-api.com/price/XAU";

interface VangPrice {
  name: string; buy: number; sell: number;
  change_buy: number; change_sell: number; currency: string;
}
interface VangResponse {
  success: boolean; time: string; date: string;
  prices: Record<string, VangPrice>;
}

/** Vietnamese display names — the upstream ships English labels. */
const VI_NAME: Record<string, string> = {
  BTSJC: "Bảo Tín SJC",
  BT9999NTT: "Bảo Tín 9999",
  DOJINHTV: "DOJI Nhẫn tròn",
  SJC: "SJC 9999",
  PNJ: "PNJ",
};

const WORLD_KEY = "XAUUSD";

export async function getGold(): Promise<GoldSnapshot> {
  return cached("gold", 120_000, async () => {
    const r = await fetchJson<VangResponse>(VANG, { feed: "vang.today" });
    if (!r?.success || !r.prices) throw new FeedError("gold", "malformed payload");

    const rows: GoldRow[] = [];
    let world: GoldRow | undefined;

    for (const [code, p] of Object.entries(r.prices)) {
      const row: GoldRow = {
        code,
        name: VI_NAME[code] ?? p.name,
        buy: p.buy,
        sell: p.sell,
        changeBuy: p.change_buy ?? 0,
        changeSell: p.change_sell ?? 0,
        currency: p.currency === "USD" ? "USD" : "VND",
      };
      if (code === WORLD_KEY) world = row;
      // Some brands publish a bid but no ask; a zero ask is missing data, not free gold.
      else if (row.buy > 0) rows.push(row);
    }

    if (!world) {
      try {
        const g = await fetchJson<{ price: number }>(GOLD_API, { feed: "gold-api" });
        world = {
          code: WORLD_KEY, name: "XAU/USD", buy: g.price, sell: g.price,
          changeBuy: 0, changeSell: 0, currency: "USD",
        };
      } catch {
        // World leg is optional; the domestic board still stands on its own.
      }
    }

    if (!rows.length) throw new FeedError("gold", "no domestic rows");
    rows.sort((a, b) => b.sell - a.sell);
    return { rows, world, updatedAt: r.time, date: r.date };
  });
}


/**
 * The brand a Vietnamese reader means by "giá vàng hôm nay".
 *
 * Rows are sorted by ask, so rows[0] is whichever brand happens to quote highest
 * today (often a minor one) — never the right headline. Prefer the canonical SJC
 * bar, then the well-known chains, and only then fall back to the top row.
 */
const HEADLINE_PRIORITY = ["SJL1L10", "SJ9999", "BTSJC", "DOHCML", "DOHNL", "PQHNVM"];

export function headlineRow(rows: GoldRow[]): GoldRow | undefined {
  for (const code of HEADLINE_PRIORITY) {
    const hit = rows.find((r) => r.code === code);
    if (hit) return hit;
  }
  return rows[0];
}
