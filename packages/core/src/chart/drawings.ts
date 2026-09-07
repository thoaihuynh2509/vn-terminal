/**
 * Chart drawings.
 *
 * Coordinates are stored in DATA space — a unix timestamp and a price — never in
 * pixels. A pixel-space drawing looks correct until the reader changes the range
 * or resizes the window, at which point it silently detaches from the bar it was
 * drawn against. Data space survives zoom, resize and re-fetch.
 *
 * Pure and dependency-free so the geometry and hit-testing are unit tested; the
 * component only maps these values through its scales.
 */
export type DrawingKind = "hline" | "trend" | "fib" | "fibext" | "channel" | "trade";

/** Any two anchored points. Several tools are built from one. */
export interface Segment {
  t1: number; p1: number;
  t2: number; p2: number;
}

export interface HLine {
  id: string;
  kind: "hline";
  price: number;
}

export interface TrendLine extends Segment {
  id: string;
  kind: "trend";
}

/**
 * Fibonacci anchors. The two points are the swing being measured: `1` is where
 * the move started and `2` is where it ended.
 */
export interface FibDrawing {
  id: string;
  kind: "fib" | "fibext";
  t1: number; p1: number;
  t2: number; p2: number;
}

/**
 * A parallel channel: a baseline through points 1 and 2, plus a line parallel to
 * it through point 3.
 *
 * The third point is stored as a POINT, not as a width. A stored width would be
 * a price distance, which stops meaning the same thing the moment the chart is
 * redrawn on a log scale or the symbol is re-fetched at a different precision;
 * a point is an anchor the channel can always be rebuilt from.
 */
export interface ChannelDrawing extends Segment {
  id: string;
  kind: "channel";
  t3: number; p3: number;
}

/**
 * "I bought here."
 *
 * Not a line but a POSITION: an entry price at a moment, which the chart can
 * then answer two questions about — how far price has moved from it, and whether
 * the shares have settled and can actually be sold. Both are specific to holding
 * something, which is why this is the artifact a reader comes back to check.
 */
export interface TradeMarker {
  id: string;
  kind: "trade";
  /** When the shares were bought, in seconds. */
  t: number;
  price: number;
  /** Optional size, purely so the reader can tell two entries apart. */
  qty?: number;
}

export type Drawing = HLine | TrendLine | FibDrawing | ChannelDrawing | TradeMarker;

/** Price gap between the baseline and the parallel line. */
export function channelOffset(d: ChannelDrawing): number {
  return d.p3 - trendPriceAt(d, d.t3);
}

/** Both edges of the channel at a given time. */
export function channelPrices(d: ChannelDrawing, t: number): { base: number; parallel: number } {
  const base = trendPriceAt(d, t);
  return { base, parallel: base + channelOffset(d) };
}

/** The parallel edge as a segment, for rendering and hit-testing. */
export function channelParallel(d: ChannelDrawing): Segment {
  const off = channelOffset(d);
  return { t1: d.t1, p1: d.p1 + off, t2: d.t2, p2: d.p2 + off };
}

/** Distance to whichever edge of the channel is nearer. */
export function distanceToChannel(
  d: ChannelDrawing,
  t: number,
  p: number,
  norm: { t: (v: number) => number; p: (v: number) => number },
): number {
  return Math.min(
    distanceToTrend(d, t, p, norm),
    distanceToTrend(channelParallel(d), t, p, norm),
  );
}

/** Retracement ratios, in the order every charting package lists them. */
export const FIB_RATIOS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1] as const;

/** Extension ratios, projecting the move beyond its end. */
export const FIB_EXT_RATIOS = [1, 1.272, 1.414, 1.618, 2, 2.618] as const;

/**
 * Level prices for a Fibonacci drawing.
 *
 * The direction convention is the one traders expect and the easiest thing to
 * get backwards: on a RETRACEMENT the 0% level sits at the END of the swing and
 * 100% at its START, because a retracement measures how far price has come back
 * from the move. Putting 0% at the start instead mirrors every level about the
 * midpoint, which looks plausible on screen and is wrong at every price.
 *
 * An EXTENSION runs the other way: 100% is the end of the swing and the higher
 * ratios project past it.
 */
export function fibLevels(d: FibDrawing): { ratio: number; price: number }[] {
  const span = d.p2 - d.p1;
  const ratios = d.kind === "fib" ? FIB_RATIOS : FIB_EXT_RATIOS;
  return ratios.map((ratio) => ({
    ratio,
    price: d.kind === "fib" ? d.p1 + span * (1 - ratio) : d.p1 + span * ratio,
  }));
}

/**
 * Distance to the nearest Fibonacci level, in price units, for hit-testing.
 * Levels extend to the right of the drawing but not to its left, so clicking
 * older bars does not delete a drawing anchored to a later swing.
 */
export function distanceToFib(d: FibDrawing, t: number, price: number): number {
  if (t < Math.min(d.t1, d.t2)) return Infinity;
  return Math.min(...fibLevels(d).map((l) => Math.abs(l.price - price)));
}

export function newId(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** Vertical distance from a price level, in price units. */
export function distanceToHLine(d: HLine, price: number): number {
  return Math.abs(d.price - price);
}

/**
 * Perpendicular distance from a point to the trendline's infinite extension,
 * measured in the caller's units. Callers pass normalised coordinates so that
 * time and price — wildly different magnitudes — contribute comparably.
 */
export function distanceToTrend(
  d: Segment,
  t: number,
  p: number,
  norm: { t: (v: number) => number; p: (v: number) => number },
): number {
  const x1 = norm.t(d.t1), y1 = norm.p(d.p1);
  const x2 = norm.t(d.t2), y2 = norm.p(d.p2);
  const x0 = norm.t(t), y0 = norm.p(p);
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len === 0) return Math.hypot(x0 - x1, y0 - y1);
  // Clamp to the segment so the line is only "hit" between its endpoints.
  const u = Math.max(0, Math.min(1, ((x0 - x1) * dx + (y0 - y1) * dy) / (len * len)));
  return Math.hypot(x0 - (x1 + u * dx), y0 - (y1 + u * dy));
}

/** Price of a trendline at a given time, extended beyond its endpoints. */
export function trendPriceAt(d: Segment, t: number): number {
  if (d.t2 === d.t1) return d.p2;
  const slope = (d.p2 - d.p1) / (d.t2 - d.t1);
  return d.p1 + slope * (t - d.t1);
}

export const STORAGE_PREFIX = "drawings:";

export function storageKey(symbol: string): string {
  return `${STORAGE_PREFIX}${symbol.toUpperCase()}`;
}

/** Tolerant parse: a corrupt entry yields an empty canvas, never a crash. */
export function parseDrawings(raw: string | null): Drawing[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v.filter((d): d is Drawing => {
      if (!d || typeof d.id !== "string") return false;
      if (d.kind === "hline") return Number.isFinite(d.price);
      if (d.kind === "trend" || d.kind === "fib" || d.kind === "fibext") {
        return [d.t1, d.p1, d.t2, d.p2].every(Number.isFinite);
      }
      if (d.kind === "channel") {
        return [d.t1, d.p1, d.t2, d.p2, d.t3, d.p3].every(Number.isFinite);
      }
      // A trade with a non-positive entry would make every unrealised figure
      // meaningless, so it is not storable rather than stored and ignored.
      if (d.kind === "trade") return Number.isFinite(d.t) && Number.isFinite(d.price) && d.price > 0;
      return false;
    });
  } catch {
    return [];
  }
}

export function serializeDrawings(drawings: Drawing[]): string {
  return JSON.stringify(drawings);
}
