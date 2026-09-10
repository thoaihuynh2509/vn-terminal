import { Ticker } from "./Ticker";
import { getGold } from "@/lib/providers/gold";
import { getIndices } from "@/lib/providers/vnstock";
import type { Locale } from "@/lib/types";

/**
 * Server wrapper so the strip can live in the layout and appear on every page.
 * Both feeds share the app's TTL cache, so this costs one fetch per minute
 * across the whole site rather than one per page view.
 */
export async function TickerStrip({ locale }: { locale: Locale }) {
  const [i, g] = await Promise.allSettled([getIndices(), getGold()]);
  const indices = i.status === "fulfilled" ? i.value : [];
  const gold = g.status === "fulfilled" ? g.value : null;
  if (!indices.length && !gold) return null;
  return <Ticker indices={indices} gold={gold} locale={locale} />;
}
