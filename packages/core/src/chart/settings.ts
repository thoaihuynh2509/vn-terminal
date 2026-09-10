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
  /**
   * Reader-set price-pane height, as a FRACTION of the viewport, or `null` for
   * the automatic size.
   *
   * A fraction rather than pixels because this setting syncs: a 900px pane
   * dragged out on a desktop would be taller than a phone's whole screen, and
   * restoring it there would push every other pane off the page. A fraction
   * says what the reader actually meant — "give the price about this much of
   * the screen" — and travels.
   */
  paneRatio: number | null;
}

export const SETTINGS_KEY = "settings:chart";

export const DEFAULT_SETTINGS: ChartSettings = {
  type: "candle", indicators: ["sma20"], scale: DEFAULT_SCALE, paneRatio: null,
};

/**
 * Bounds on the price pane's share of the viewport.
 *
 * The floor keeps the candles readable; the ceiling keeps the volume pane, the
 * oscillators and the toolbar from being pushed off the bottom, which a drag
 * with no upper bound will do on the first try.
 */
export const MIN_PANE_RATIO = 0.25;
export const MAX_PANE_RATIO = 0.85;

/** A stored or dragged ratio, brought inside the usable range. */
export function clampPaneRatio(r: number): number {
  // Only NaN needs a guard: it defeats every comparison, so Math.min/max would
  // propagate it. Infinities clamp correctly on their own, and clamping them to
  // the floor — as an is-finite guard would — turns "as tall as possible" into
  // "as short as possible".
  if (Number.isNaN(r)) return MIN_PANE_RATIO;
  return Math.min(MAX_PANE_RATIO, Math.max(MIN_PANE_RATIO, r));
}

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
    // A stored ratio is clamped rather than trusted: hand-edited storage should
    // not be able to collapse the chart to nothing.
    const paneRatio = typeof v.paneRatio === "number" && Number.isFinite(v.paneRatio)
      ? clampPaneRatio(v.paneRatio)
      : null;
    return { type, indicators, scale, paneRatio };
  } catch {
    return null;
  }
}

export function serializeSettings(s: ChartSettings): string {
  return JSON.stringify({ type: s.type, indicators: s.indicators, scale: s.scale, paneRatio: s.paneRatio });
}

/**
 * Restoring is capped by the tier, not just stored blindly: a reader who had
 * eight indicators on Plus and let it lapse must come back to a working chart
 * with the first two, not a silently over-budget one that the next toggle then
 * refuses to change.
 */
export function restorable(
  s: ChartSettings,
  indicatorLimit: number,
  known: (id: string) => boolean,
  /**
   * Whether this reader may have that indicator at all. An indicator saved on
   * Plus must not come back after the subscription lapsed — the stored setup is
   * a preference, never an entitlement.
   *
   * It lives here rather than in the caller because the caller got it wrong:
   * ChartPro filtered the RESULT of this function by token instead of by id, so
   * `rsi:21` matched no definition and every tuned indicator was dropped from
   * the restored chart. One question, asked once, in the place that already
   * knows tokens are not ids.
   */
  entitled: (id: string) => boolean = () => true,
): ChartSettings {
  return {
    type: s.type,
    scale: s.scale,
    paneRatio: s.paneRatio,
    // Both predicates answer about an INDICATOR, so both are asked about the
    // id — passing the whole `rsi:21` token would make every tuned indicator
    // look unknown. Applied before the slice, so an indicator the reader may
    // not have does not silently eat one of their slots.
    indicators: s.indicators
      .filter((t) => { const r = parseRef(t); return !!r && known(r.id) && entitled(r.id); })
      .slice(0, Math.max(0, indicatorLimit)),
  };
}
