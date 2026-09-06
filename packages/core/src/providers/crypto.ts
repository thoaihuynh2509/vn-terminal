import { cached, fetchJson } from "../cache";
import { FeedError, type Bar, type Coin } from "../types";

/**
 * Crypto. CoinGecko's public tier needs no key but is rate-limited per IP, so
 * everything here goes through the shared TTL cache and one list request backs
 * the whole board rather than one request per coin.
 */
const CG = "https://api.coingecko.com/api/v3";

interface CgMarket {
  id: string; symbol: string; name: string; current_price: number;
  price_change_percentage_24h: number | null; market_cap: number;
  total_volume: number; market_cap_rank: number;
  sparkline_in_7d?: { price: number[] };
}

export async function getCoins(limit = 50): Promise<Coin[]> {
  return cached(`coins:${limit}`, 90_000, async () => {
    const r = await fetchJson<CgMarket[]>(
      `${CG}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${limit}` +
        `&page=1&sparkline=true&price_change_percentage=24h`,
      { feed: "coingecko", timeoutMs: 10_000 },
    );
    if (!Array.isArray(r) || !r.length) throw new FeedError("crypto", "empty market list");
    return r.map((c) => ({
      id: c.id,
      symbol: c.symbol.toUpperCase(),
      name: c.name,
      price: c.current_price,
      changePct24h: c.price_change_percentage_24h ?? 0,
      marketCap: c.market_cap,
      volume24h: c.total_volume,
      rank: c.market_cap_rank,
      sparkline: c.sparkline_in_7d?.price,
    }));
  });
}

/**
 * Look up one coin.
 *
 * Returns `null` only when the upstream answered and the id genuinely is not
 * there — a throw means the feed itself failed. Collapsing the two turns a
 * CoinGecko 429 into "this coin does not exist", which is a lie the UI then
 * renders as a 404.
 *
 * Tries the cached top-50 first (already warm for the list page), then a
 * targeted single-id request rather than pulling 250 rows.
 */
export async function getCoin(id: string): Promise<Coin | null> {
  const cheap = await getCoins(50);
  const hit = cheap.find((c) => c.id === id);
  if (hit) return hit;

  return cached(`coin:${id}`, 90_000, async () => {
    const r = await fetchJson<CgMarket[]>(
      `${CG}/coins/markets?vs_currency=usd&ids=${encodeURIComponent(id)}` +
        `&sparkline=true&price_change_percentage=24h`,
      { feed: "coingecko", timeoutMs: 10_000 },
    );
    if (!Array.isArray(r)) throw new FeedError("crypto", `bad response for ${id}`);
    const c = r[0];
    if (!c) return null; // upstream answered; this id does not exist
    return {
      id: c.id,
      symbol: c.symbol.toUpperCase(),
      name: c.name,
      price: c.current_price,
      changePct24h: c.price_change_percentage_24h ?? 0,
      marketCap: c.market_cap,
      volume24h: c.total_volume,
      rank: c.market_cap_rank,
      sparkline: c.sparkline_in_7d?.price,
    };
  });
}

export async function getCoinBars(id: string, days = 90): Promise<Bar[]> {
  return cached(`coinbars:${id}:${days}`, 300_000, async () => {
    const r = await fetchJson<{ prices: [number, number][] }>(
      `${CG}/coins/${id}/market_chart?vs_currency=usd&days=${days}&interval=daily`,
      { feed: "coingecko", timeoutMs: 10_000 },
    );
    if (!r?.prices?.length) throw new FeedError("crypto", `no chart for ${id}`);
    // market_chart returns closes only — synthesise OHLC so one chart component
    // can render both equities and crypto without branching on shape.
    return r.prices.map(([ms, p], i, arr) => {
      const prev = i > 0 ? arr[i - 1][1] : p;
      return { t: Math.floor(ms / 1000), o: prev, h: Math.max(prev, p), l: Math.min(prev, p), c: p, v: 0 };
    });
  });
}
