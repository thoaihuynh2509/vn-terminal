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

import { isChartType, type ChartTypeId } from "./chart-types.ts";
import { DEFAULT_APPEARANCE, parseAppearance, type Appearance } from "./appearance.ts";
export type { ChartTypeId } from "./chart-types.ts";

export interface ChartSettings {
  type: ChartTypeId;
  /** Indicator tokens (`id` or `id:period`), in the order the reader added them. */
  indicators: string[];
  /** Price axis. A preference, so it is remembered like the chart type. */
  scale: ScaleId;
  /**
   * Reader-set chart workspace height, as a FRACTION of the viewport, or `null`
   * for "fill the window".
   *
   * A fraction rather than pixels because this setting syncs: a height dragged
   * out on a desktop would be meaningless on a phone. A fraction says what the
   * reader meant — "this much of the screen" — and travels.
   *
   * The chart before the workspace stored the price pane's share as `paneRatio`. That measures
   * something else, so it is never read: those readers get the window-filling default.
   */
  wsRatio: number | null;
  /** How the chart looks; absent on setups saved before it existed, which read as the defaults. */
  appearance?: Appearance;
}

export const SETTINGS_KEY = "settings:chart";

export const DEFAULT_SETTINGS: ChartSettings = {
  type: "candle", indicators: ["sma20"], scale: DEFAULT_SCALE, wsRatio: null, appearance: DEFAULT_APPEARANCE,
};

/**
 * Bounds on the workspace's share of the viewport. The floor keeps the candles
 * readable; the ceiling lets a reader with many indicator panes make the chart
 * taller than the window, but not endlessly so.
 */
export const MIN_WS_RATIO = 0.4;
export const MAX_WS_RATIO = 2;

/** A stored or dragged ratio, brought inside the usable range. */
export function clampWsRatio(r: number): number {
  // Only NaN needs a guard: it defeats every comparison, so Math.min/max would
  // propagate it. Infinities clamp correctly on their own, and clamping them to
  // the floor — as an is-finite guard would — turns "as tall as possible" into
  // "as short as possible".
  if (Number.isNaN(r)) return MIN_WS_RATIO;
  return Math.min(MAX_WS_RATIO, Math.max(MIN_WS_RATIO, r));
}


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
    const type = isChartType(v.type) ? v.type : DEFAULT_SETTINGS.type;
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
    const wsRatio = typeof v.wsRatio === "number" && Number.isFinite(v.wsRatio)
      ? clampWsRatio(v.wsRatio)
      : null;
    return { type, indicators, scale, wsRatio, appearance: parseAppearance((v as { appearance?: unknown }).appearance) };
  } catch {
    return null;
  }
}

export function serializeSettings(s: ChartSettings): string {
  return JSON.stringify({
    type: s.type, indicators: s.indicators, scale: s.scale, wsRatio: s.wsRatio, appearance: s.appearance ?? DEFAULT_APPEARANCE,
  });
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
    wsRatio: s.wsRatio,
    appearance: s.appearance ?? DEFAULT_APPEARANCE,
    // Both predicates answer about an INDICATOR, so both are asked about the
    // id — passing the whole `rsi:21` token would make every tuned indicator
    // look unknown. Applied before the slice, so an indicator the reader may
    // not have does not silently eat one of their slots.
    indicators: s.indicators
      .filter((t) => { const r = parseRef(t); return !!r && known(r.id) && entitled(r.id); })
      .slice(0, Math.max(0, indicatorLimit)),
  };
}
