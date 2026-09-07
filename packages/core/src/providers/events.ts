import { cached, fetchJson } from "../cache";
import { parseEvents, type CorpEvent, type RawEvent } from "../chart/events";

/**
 * Corporate events (dividends, stock dividends, rights issues) from VNDirect's
 * finfo v4 index.
 *
 * Chosen after probing seven candidate endpoints (`scripts/probe-events.mjs`):
 * it was the only free feed that returns corporate actions as JSON. DNSE, SSI
 * iBoard and CafeF have no such route, and Vietstock answers HTML — which the
 * roadmap rules out, because reading it would mean writing a scraper.
 *
 * Treated exactly like the other unofficial feeds here: cached hard, failing
 * soft. Markers are a garnish on the chart, so a bad day upstream must cost the
 * reader nothing more than a chart without them.
 */
const FINFO = "https://api-finfo.vndirect.com.vn/v4/events";

/**
 * The index caps a page at 50 rows regardless of what `size` asks for, so this
 * is the real ceiling, not a preference. Sorted newest-first, 50 rows is
 * several years of events for one symbol — well past any chart window.
 */
const PAGE = 50;

/** A day: these are declared weeks ahead and never change intraday. */
const TTL_MS = 24 * 60 * 60 * 1000;

interface EventsResponse { data?: RawEvent[] }

/**
 * Events for one symbol, newest first, already deduped for `locale`.
 *
 * Returns `[]` on any failure rather than throwing: this is called on the chart
 * render path, and no dividend marker is worth a blank chart.
 */
export async function getCorpEvents(symbol: string, locale: "vi" | "en"): Promise<CorpEvent[]> {
  const sym = symbol.toUpperCase();
  // The locale only selects which duplicate row is kept, so both locales share
  // one upstream fetch and the cache key covers the parsed result.
  return cached(`events:${sym}:${locale}`, TTL_MS, async () => {
    try {
      const r = await fetchJson<EventsResponse>(
        `${FINFO}?q=code:${encodeURIComponent(sym)}&size=${PAGE}&sort=effectiveDate:desc`,
        { feed: "vndirect-events" },
      );
      return parseEvents(r.data ?? [], locale);
    } catch {
      // No events pane rather than no chart.
      return [];
    }
  });
}
