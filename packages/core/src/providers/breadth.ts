/**
 * Market breadth for the VN30, from its members' own daily bars.
 *
 * This is the most expensive thing the app fetches: one request per member. It
 * is cached for an hour and computed on DAILY bars only, because breadth is a
 * daily measure — recomputing it per intraday interval would multiply the cost
 * for a number that does not change between them.
 *
 * A member whose feed fails is dropped rather than failing the whole series;
 * `computeBreadth` already refuses to report a reading taken on too few of them,
 * so a bad fetch degrades the measure honestly instead of skewing it.
 */
import { computeBreadth, type BreadthPoint, type Member } from "../breadth.ts";
import { cached } from "../cache.ts";
import { getBars } from "./vnstock.ts";
import { HOSE_SYMBOLS } from "../universe.ts";

const HOUR = 3_600_000;
/** Enough history for a 20-day average plus a usable stretch of chart. */
const DAYS = 260;
const CONCURRENCY = 6;

export async function getBreadth(period = 20): Promise<BreadthPoint[]> {
  return cached(`breadth:vn30:${period}:${DAYS}`, HOUR, async () => {
    const members: Member[] = [];
    const queue = [...HOSE_SYMBOLS];

    // Same bounded fan-out the board uses: the upstream is an unofficial
    // endpoint with no published rate limit, and thirty parallel requests is how
    // you find out where it is.
    await Promise.all(
      Array.from({ length: CONCURRENCY }, async () => {
        for (;;) {
          const symbol = queue.shift();
          if (!symbol) return;
          try {
            const bars = await getBars(symbol, { days: DAYS });
            if (bars.length) members.push({ symbol, bars });
          } catch {
            /* one member's feed failing must not cost the whole measure */
          }
        }
      }),
    );

    return computeBreadth(members, period);
  });
}
