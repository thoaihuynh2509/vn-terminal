/**
 * The part of the chart a link can carry.
 *
 * Symbol, timeframe, layout, compare and the foreign pane were already in the
 * URL. Chart type, active indicators and the visible range were not — so a link
 * a reader sent never showed what they were actually looking at, and their own
 * bookmark came back as a default chart. Everything a reader can SEE belongs in
 * the address bar; everything they merely prefer belongs in storage.
 *
 * Decoding is tier-aware and happens on the SERVER, so a hand-typed `?ind=` full
 * of paid indicators is trimmed before the page is rendered rather than being
 * corrected afterwards in the browser — the same fail-closed rule the intraday
 * timeframe already follows.
 */
import { INDICATOR_LIMIT, can, type Tier } from "../auth/entitlement.ts";
import { parseRef } from "../ta/params.ts";
import { isTvRange, type TvRange } from "./range-interval.ts";
import { DEFAULT_SCALE, isScale, type ScaleId } from "./scale.ts";

import { isChartType, type ChartTypeId } from "./chart-types.ts";
export type { ChartTypeId } from "./chart-types.ts";

export interface ChartView {
  type: ChartTypeId;
  /** Indicator tokens (`id` or `id:period`), trimmed to what this tier may show. */
  ind: string[];
  range: TvRange | null;
  /** Price axis: linear, logarithmic or percent change. Free for every tier. */
  scale: ScaleId;
}

export const DEFAULT_VIEW: ChartView = { type: "candle", ind: [], range: null, scale: DEFAULT_SCALE };

/**
 * Indicator tokens are `id` or `id:period` — `parseRef` owns the grammar, so
 * the URL and the toolbar cannot disagree about what a token means.
 *
 * A hostile `?ind=` should cost a parse, not a loop over thousands of ids.
 */
const MAX_IDS = 40;

export interface DecodeOptions {
  tier: Tier;
  /** Whether an id exists in this build, and whether it is free. */
  known: (id: string) => boolean;
  isFree: (id: string) => boolean;
}

/**
 * Read a view out of query parameters.
 *
 * Unknown values fall back rather than 404 — a link from an older build, or one
 * mangled by a chat client, should still open the chart it names.
 */
export function decodeView(
  params: { type?: string | null; ind?: string | null; r?: string | null; sc?: string | null },
  { tier, known, isFree }: DecodeOptions,
): ChartView {
  const type = isChartType(params.type)
    ? params.type
    : DEFAULT_VIEW.type;

  const range = isTvRange(params.r) ? params.r : null;

  // Not tier-gated: reading a chart on the right axis is a basic, and a gate
  // here would make a shared link open on a different scale than it was sent.
  const scale = isScale(params.sc) ? params.sc : DEFAULT_SCALE;

  const unlocked = can(tier, "chart:indicators");
  const limit = INDICATOR_LIMIT[tier];
  const seen = new Set<string>();
  const ind: string[] = [];
  for (const raw of (params.ind ?? "").split(",").slice(0, MAX_IDS)) {
    const ref = parseRef(raw);
    // Deduped by INDICATOR, not by token: `rsi,rsi:21` is one reader changing
    // their mind, not two RSI panes.
    if (!ref || seen.has(ref.id) || !known(ref.id)) continue;
    // A link cannot grant an entitlement: a paid indicator in the query string
    // is dropped for a tier that does not hold one, not rendered and then
    // retracted.
    if (!unlocked && !isFree(ref.id)) continue;
    if (ind.length >= limit) break;
    seen.add(ref.id);
    // The period is NOT clamped here — the registry owns the range, and
    // `effectivePeriod` clamps at compute time so one rule covers URL, storage
    // and the settings popover alike.
    ind.push(ref.period === null ? ref.id : `${ref.id}:${ref.period}`);
  }

  return { type, ind, range, scale };
}

/**
 * The query fragment for a view. Defaults are OMITTED, so a plain chart still
 * has a clean, sharable URL instead of one carrying its own default state.
 */
export function encodeView(view: ChartView): string {
  const p = new URLSearchParams();
  if (view.type !== DEFAULT_VIEW.type) p.set("type", view.type);
  if (view.ind.length) p.set("ind", view.ind.join(","));
  if (view.range) p.set("r", view.range);
  if (view.scale !== DEFAULT_VIEW.scale) p.set("sc", view.scale);
  return p.toString();
}

/**
 * Merge a view into an existing query string, preserving every parameter this
 * module does not own (`tf`, `layout`, `s`, `cmp`, `fr`, `rail`, `src`).
 * Rewriting the whole string would silently drop a reader's multi-chart grid.
 */
export function mergeViewIntoQuery(current: string, view: ChartView): string {
  const p = new URLSearchParams(current);
  for (const key of ["type", "ind", "r", "sc"]) p.delete(key);
  for (const [k, v] of new URLSearchParams(encodeView(view))) p.set(k, v);
  return p.toString();
}
