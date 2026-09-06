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
export type ChartTypeId = "candle" | "line" | "area";

export interface ChartSettings {
  type: ChartTypeId;
  /** Indicator ids, in the order the reader added them. */
  indicators: string[];
}

export const SETTINGS_KEY = "settings:chart";

export const DEFAULT_SETTINGS: ChartSettings = { type: "candle", indicators: ["sma20"] };

const TYPES: ChartTypeId[] = ["candle", "line", "area"];

/** Ids are registry keys; anything else is not something we can draw. */
const ID_RE = /^[a-z][a-z0-9]{0,23}$/;

export function parseSettings(raw: string | null): ChartSettings | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<ChartSettings>;
    if (typeof v !== "object" || v === null) return null;
    const type = TYPES.includes(v.type as ChartTypeId) ? (v.type as ChartTypeId) : DEFAULT_SETTINGS.type;
    const indicators = Array.isArray(v.indicators)
      ? [...new Set(v.indicators.filter((x): x is string => typeof x === "string" && ID_RE.test(x)))]
      : [];
    return { type, indicators };
  } catch {
    return null;
  }
}

export function serializeSettings(s: ChartSettings): string {
  return JSON.stringify({ type: s.type, indicators: s.indicators });
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
    indicators: s.indicators.filter(known).slice(0, Math.max(0, indicatorLimit)),
  };
}
