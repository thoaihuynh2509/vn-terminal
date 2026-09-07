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
export type DrawingKind =
  | "hline" | "trend" | "fib" | "fibext" | "channel" | "trade"
  | "ray" | "vline" | "rect" | "text" | "measure";

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

/**
 * A trendline that stops mattering at its second point is a segment; one that
 * keeps going is a ray. Traders draw both, and which they meant is not
 * recoverable after the fact, so it is stored rather than inferred.
 */
export interface RayLine extends Segment {
  id: string;
  kind: "ray";
}

/** A moment worth marking — an earnings date, a policy announcement. */
export interface VLine {
  id: string;
  kind: "vline";
  t: number;
}

/** A box over a region of the chart: a range, a consolidation, an event window. */
export interface RectDrawing extends Segment {
  id: string;
  kind: "rect";
}

/** A note anchored to a bar and a price, so it moves with the data. */
export interface TextNote {
  id: string;
  kind: "text";
  t: number;
  price: number;
  text: string;
}

/**
 * A measurement between two points.
 *
 * Stored like any other drawing rather than being a transient overlay: a reader
 * who measured a move usually wants it still there when they come back, and a
 * measurement that vanishes on the next click is a tool you have to keep
 * re-doing.
 */
export interface MeasureDrawing extends Segment {
  id: string;
  kind: "measure";
}

export type Drawing =
  | HLine | TrendLine | FibDrawing | ChannelDrawing | TradeMarker
  | RayLine | VLine | RectDrawing | TextNote | MeasureDrawing;

/** The longest note that may be stored, so one drawing cannot fill the budget. */
export const MAX_TEXT_LEN = 120;

/**
 * An editable point on a drawing.
 *
 * `axis` says which coordinates the point actually has: a horizontal line has a
 * price but no time, a vertical line the reverse. A handle that let a reader
 * drag an hline sideways would be offering a change the model cannot store.
 */
export interface Anchor {
  t: number;
  p: number;
  axis: "both" | "price" | "time";
}

/** The points a reader may grab, in a stable order per kind. */
export function anchorsOf(d: Drawing): Anchor[] {
  switch (d.kind) {
    case "hline": return [{ t: NaN, p: d.price, axis: "price" }];
    case "vline": return [{ t: d.t, p: NaN, axis: "time" }];
    case "trade": return [{ t: d.t, p: d.price, axis: "both" }];
    case "text": return [{ t: d.t, p: d.price, axis: "both" }];
    case "channel":
      return [
        { t: d.t1, p: d.p1, axis: "both" },
        { t: d.t2, p: d.p2, axis: "both" },
        { t: d.t3, p: d.p3, axis: "both" },
      ];
    default:
      return [
        { t: d.t1, p: d.p1, axis: "both" },
        { t: d.t2, p: d.p2, axis: "both" },
      ];
  }
}

/**
 * Move one anchor to a new place.
 *
 * Out-of-range indices and coordinates the anchor cannot hold are IGNORED
 * rather than applied — a drag that would move a horizontal line sideways
 * silently does nothing to the time, instead of writing a field the renderer
 * will never read back.
 */
export function moveAnchor(d: Drawing, index: number, t: number, p: number): Drawing {
  switch (d.kind) {
    case "hline": return index === 0 ? { ...d, price: p } : d;
    case "vline": return index === 0 ? { ...d, t } : d;
    case "trade": return index === 0 ? { ...d, t, price: p } : d;
    case "text": return index === 0 ? { ...d, t, price: p } : d;
    case "channel":
      if (index === 0) return { ...d, t1: t, p1: p };
      if (index === 1) return { ...d, t2: t, p2: p };
      if (index === 2) return { ...d, t3: t, p3: p };
      return d;
    default:
      if (index === 0) return { ...d, t1: t, p1: p };
      if (index === 1) return { ...d, t2: t, p2: p };
      return d;
  }
}

/** Shift a whole drawing by a time and price delta, keeping its shape. */
export function translate(d: Drawing, dt: number, dp: number): Drawing {
  switch (d.kind) {
    case "hline": return { ...d, price: d.price + dp };
    case "vline": return { ...d, t: d.t + dt };
    case "trade": return { ...d, t: d.t + dt, price: d.price + dp };
    case "text": return { ...d, t: d.t + dt, price: d.price + dp };
    case "channel":
      return { ...d, t1: d.t1 + dt, p1: d.p1 + dp, t2: d.t2 + dt, p2: d.p2 + dp, t3: d.t3 + dt, p3: d.p3 + dp };
    default:
      return { ...d, t1: d.t1 + dt, p1: d.p1 + dp, t2: d.t2 + dt, p2: d.p2 + dp };
  }
}

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

/**
 * Perpendicular distance to a RAY — a segment whose second point is a direction
 * rather than an end. Clamped only at the start, so the line keeps mattering to
 * the right of where it was drawn, which is the whole reason to pick a ray.
 */
export function distanceToRay(
  d: Segment,
  t: number,
  p: number,
  norm: { t: (v: number) => number; p: (v: number) => number },
): number {
  const x1 = norm.t(d.t1), y1 = norm.p(d.p1);
  const x2 = norm.t(d.t2), y2 = norm.p(d.p2);
  const x0 = norm.t(t), y0 = norm.p(p);
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(x0 - x1, y0 - y1);
  const u = Math.max(0, ((x0 - x1) * dx + (y0 - y1) * dy) / len2);
  return Math.hypot(x0 - (x1 + u * dx), y0 - (y1 + u * dy));
}

/**
 * Distance to a rectangle's nearest EDGE.
 *
 * Zero inside the box would make a rectangle swallow every click over the
 * region it covers, including on drawings beneath it. A box is grabbed by its
 * outline, the same way every other drawing here is.
 */
export function distanceToRect(
  d: Segment,
  t: number,
  p: number,
  norm: { t: (v: number) => number; p: (v: number) => number },
): number {
  const edges: Segment[] = [
    { t1: d.t1, p1: d.p1, t2: d.t2, p2: d.p1 },
    { t1: d.t2, p1: d.p1, t2: d.t2, p2: d.p2 },
    { t1: d.t2, p1: d.p2, t2: d.t1, p2: d.p2 },
    { t1: d.t1, p1: d.p2, t2: d.t1, p2: d.p1 },
  ];
  return Math.min(...edges.map((e) => distanceToTrend(e, t, p, norm)));
}

/**
 * Distance from a point to any drawing, in normalised units.
 *
 * One dispatcher rather than a chain of `if (d.kind === ...)` at each call site:
 * select, move and erase all have to agree about what "you clicked this" means,
 * and three copies of that rule would drift.
 */
export function distanceTo(
  d: Drawing,
  t: number,
  p: number,
  norm: { t: (v: number) => number; p: (v: number) => number },
): number {
  switch (d.kind) {
    // A horizontal line spans the pane, so only the price gap matters.
    case "hline": return Math.abs(norm.p(d.price) - norm.p(p));
    // Likewise a vertical line, in the other axis.
    case "vline": return Math.abs(norm.t(d.t) - norm.t(t));
    case "trade":
    case "text": return Math.hypot(norm.t(d.t) - norm.t(t), norm.p(d.price) - norm.p(p));
    case "channel": return distanceToChannel(d, t, p, norm);
    case "ray": return distanceToRay(d, t, p, norm);
    case "rect": return distanceToRect(d, t, p, norm);
    case "fib":
    case "fibext": {
      // Fib levels are horizontal and extend rightward only, so they are
      // measured in price — but normalised, so the number is comparable with
      // every other kind's.
      if (t < Math.min(d.t1, d.t2)) return Infinity;
      return Math.min(...fibLevels(d).map((l) => Math.abs(norm.p(l.price) - norm.p(p))));
    }
    default: return distanceToTrend(d, t, p, norm);
  }
}

/**
 * Which drawing a click grabbed, or null.
 *
 * Nearest wins, and only within `tolerance`. Ties go to the drawing added LAST,
 * because that is the one on top: picking the older one would make a reader
 * unable to grab the thing they can see.
 */
export function hitTest(
  drawings: Drawing[],
  t: number,
  p: number,
  norm: { t: (v: number) => number; p: (v: number) => number },
  tolerance: number,
): Drawing | null {
  let best: Drawing | null = null;
  let bestD = Infinity;
  for (const d of drawings) {
    const dist = distanceTo(d, t, p, norm);
    if (dist <= tolerance && dist <= bestD) { best = d; bestD = dist; }
  }
  return best;
}

/** Index of the anchor a click grabbed, or -1 when it hit none. */
export function hitAnchor(
  d: Drawing,
  t: number,
  p: number,
  norm: { t: (v: number) => number; p: (v: number) => number },
  tolerance: number,
): number {
  const anchors = anchorsOf(d);
  let best = -1;
  let bestD = Infinity;
  anchors.forEach((a, i) => {
    // An anchor missing an axis is unconstrained there: an hline handle is
    // grabbed by price alone, wherever along the pane it is drawn.
    const dt = a.axis === "price" ? 0 : norm.t(a.t) - norm.t(t);
    const dp = a.axis === "time" ? 0 : norm.p(a.p) - norm.p(p);
    const dist = Math.hypot(dt, dp);
    if (dist <= tolerance && dist < bestD) { best = i; bestD = dist; }
  });
  return best;
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
      if (d.kind === "ray" || d.kind === "rect" || d.kind === "measure") {
        return [d.t1, d.p1, d.t2, d.p2].every(Number.isFinite);
      }
      if (d.kind === "vline") return Number.isFinite(d.t);
      // An empty note would render as an invisible drawing the reader cannot
      // find to delete.
      if (d.kind === "text") {
        return Number.isFinite(d.t) && Number.isFinite(d.price)
          && typeof d.text === "string" && d.text.length > 0 && d.text.length <= MAX_TEXT_LEN;
      }
      return false;
    });
  } catch {
    return [];
  }
}

export function serializeDrawings(drawings: Drawing[]): string {
  return JSON.stringify(drawings);
}
