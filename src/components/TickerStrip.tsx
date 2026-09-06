import { Ticker } from "./Ticker";
import { getCoins } from "@/lib/providers/crypto";
import { cryptoEnabled } from "@/lib/flags";
import { getGold } from "@/lib/providers/gold";
import { getIndices } from "@/lib/providers/vnstock";
import type { Locale } from "@/lib/types";

/**
 * Server wrapper so the strip can live in the layout and appear on every page.
 * All three feeds share the app's TTL cache, so this costs one fetch per minute
 * across the whole site rather than one per page view.
 */
export async function TickerStrip({ locale }: { locale: Locale }) {
  const [i, g, c] = await Promise.allSettled([getIndices(), getGold(), cryptoEnabled() ? getCoins(10) : Promise.resolve([])]);
  const indices = i.status === "fulfilled" ? i.value : [];
  const gold = g.status === "fulfilled" ? g.value : null;
  const coins = c.status === "fulfilled" ? c.value : [];
  if (!indices.length && !gold && !coins.length) return null;
  return <Ticker indices={indices} gold={gold} coins={coins} locale={locale} />;
}
