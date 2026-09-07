/**
 * The reader's chart setup — what the chart should look like when they come
 * back to it.
 *
 * Active indicators were plain component state, so every reload and every
 * navigation reset the chart to a single SMA. A workspace that forgets what you
 * did to it thirty seconds ago cannot become a daily habit, which is the whole
 * point of the thing.
 *
 * Parsing is tolerant by design: this is reader-owned storage that a browser
 * extension, an older build, or a half-finished write can corrupt, and the right
 * answer to a bad settings blob is the default chart, never a crash.
 */
import { parseRef } from "../ta/params.ts";
import { DEFAULT_SCALE, isScale, type ScaleId } from "./scale.ts";

export type ChartTypeId = "candle" | "line" | "area";

export interface ChartSettings {
  type: ChartTypeId;
  /** Indicator tokens (`id` or `id:period`), in the order the reader added them. */
  indicators: string[];
  /** Price axis. A preference, so it is remembered like the chart type. */
  scale: ScaleId;
}

export const SETTINGS_KEY = "settings:chart";

export const DEFAULT_SETTINGS: ChartSettings = { type: "candle", indicators: ["sma20"], scale: DEFAULT_SCALE };

const TYPES: ChartTypeId[] = ["candle", "line", "area"];

/**
 * Entries are indicator TOKENS — `rsi` or `rsi:21`. `parseRef` owns the grammar
 * so a tuned indicator survives a reload; validating against a bare-id pattern
 * would silently drop every period a reader had set.
 */

export function parseSettings(raw: string | null): ChartSettings | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<ChartSettings>;
    if (typeof v !== "object" || v === null) return null;
    const type = TYPES.includes(v.type as ChartTypeId) ? (v.type as ChartTypeId) : DEFAULT_SETTINGS.type;
    const indicators: string[] = [];
    if (Array.isArray(v.indicators)) {
      const seen = new Set<string>();
      for (const x of v.indicators) {
        if (typeof x !== "string") continue;
        const ref = parseRef(x);
        // Deduped by indicator: two tunings of the same one are one entry.
        if (!ref || seen.has(ref.id)) continue;
        seen.add(ref.id);
        indicators.push(x.trim().toLowerCase());
      }
    }
    const scale = isScale(v.scale) ? v.scale : DEFAULT_SETTINGS.scale;
    return { type, indicators, scale };
  } catch {
    return null;
  }
}

export function serializeSettings(s: ChartSettings): string {
  return JSON.stringify({ type: s.type, indicators: s.indicators, scale: s.scale });
}

/**
 * Restoring is capped by the tier, not just stored blindly: a reader who had
 * eight indicators on Plus and let it lapse must come back to a working chart
 * with the first two, not a silently over-budget one that the next toggle then
 * refuses to change.
 */
export function restorable(s: ChartSettings, indicatorLimit: number, known: (id: string) => boolean): ChartSettings {
  return {
    type: s.type,
    scale: s.scale,
    // `known` answers about an indicator, so it is asked about the id — passing
    // the whole `rsi:21` token would make every tuned indicator look unknown.
    indicators: s.indicators
      .filter((t) => { const r = parseRef(t); return !!r && known(r.id); })
      .slice(0, Math.max(0, indicatorLimit)),
  };
}
