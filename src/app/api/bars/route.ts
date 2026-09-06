import { getTimeframeBars, type Kind } from "@/lib/providers/vnstock";
import { timeframe } from "@/lib/chart/timeframes";
import { can } from "@/lib/auth/entitlement";
import { getSession } from "@/lib/auth/session";
import { fail, ok } from "@/lib/api";

export const revalidate = 0;

export async function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  const symbol = p.get("symbol");
  if (!symbol) return fail(new Error("symbol is required"), 400);

  // Same gate as the page: an intraday interval is a paid interval, and the
  // check has to live here too or the API is the way around the paywall.
  const tier = (await getSession())?.tier ?? "anon";
  const asked = timeframe(p.get("tf"));
  if (asked.intraday && !can(tier, "chart:intraday")) {
    return fail(new Error("intraday timeframes require a Plus plan"), 402);
  }

  try {
    const bars = await getTimeframeBars(symbol, asked, {
      kind: (p.get("kind") as Kind) === "index" ? "index" : "stock",
    });
    return ok(bars, 60);
  } catch (e) {
    return fail(e);
  }
}
