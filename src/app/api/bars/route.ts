import { getTimeframeBars, type Kind } from "@/lib/providers/vnstock";
import { timeframe } from "@/lib/chart/timeframes";
import { can } from "@/lib/auth/entitlement";
import { getSession } from "@/lib/auth/session";
import { clientIp, createLimiter } from "@/lib/rate-limit";
import { fail, ok, okPrivate } from "@/lib/api";

export const revalidate = 0;

/**
 * Headroom for the polling refresh (one call per 30s per open chart) and a
 * multi-chart grid reloading, while still bounding a bulk history crawl. Applied
 * before the session read so an unauthenticated flood costs no cookie work.
 */
const limited = createLimiter({ windowMs: 60_000, max: 120 });

export async function GET(req: Request) {
  if (limited(clientIp(req))) return fail(new Error("rate limited"), 429);
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

  // `before` loads older history: the window ENDING at that moment. Bounded to
  // a plausible unix second so a hand-typed value cannot send the upstream a
  // nonsense range, and ignored entirely when it is not one.
  const rawBefore = Number(p.get("before"));
  const before = Number.isFinite(rawBefore) && rawBefore > 0 && rawBefore < 4_102_444_800
    ? rawBefore
    : undefined;

  try {
    const bars = await getTimeframeBars(symbol, asked, {
      kind: (p.get("kind") as Kind) === "index" ? "index" : "stock",
      before,
    });
    // Intraday is a PAID, tier-gated payload — it must never reach a shared edge
    // cache, or an anon request for the same URL is served the paid data and the
    // 402 above never runs. Daily bars are ungated and stay publicly cacheable.
    return asked.intraday ? okPrivate(bars) : ok(bars, 60);
  } catch (e) {
    return fail(e);
  }
}
