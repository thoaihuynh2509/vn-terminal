/**
 * The visible window: panning and zooming.
 *
 * `offset` counts bars backwards from the newest bar: 0 shows the latest close
 * on the right edge, and a larger offset walks into the past. Keeping it in BARS
 * rather than pixels means a pan survives a resize, a range change and a
 * timeframe change without the window silently sliding.
 */

/** How far back the window can go before it would run off the loaded history. */
export function maxOffset(total: number, range: number): number {
  return Math.max(0, total - Math.max(1, range));
}

export function clampOffset(offset: number, total: number, range: number): number {
  if (!Number.isFinite(offset)) return 0;
  return Math.min(Math.max(0, Math.round(offset)), maxOffset(total, range));
}

/**
 * A hovered bar index brought inside the window that is actually on screen.
 *
 * The hover is picked against one window and read against another: zooming and
 * pinching re-slice the view without touching it, so an index chosen in a
 * 300-bar window outlives the window that made it valid and addresses a bar
 * that is no longer there. Clamping at the point of USE rather than at each
 * zoom handler is what makes that safe — there are four ways to change the
 * range today, and the fifth one should not be able to reintroduce this.
 */
export function clampHover(hover: number | null, length: number): number | null {
  if (hover === null || !Number.isFinite(hover) || length <= 0) return null;
  return Math.max(0, Math.min(length - 1, Math.floor(hover)));
}

/**
 * Index bounds of the visible slice, as [start, end).
 *
 * Callers need the BOUNDS and not just the bars, because indicators are computed
 * once over the whole loaded series and then sliced to the window. Recomputing
 * them per window is both slower and wrong: a 50-bar average computed on a
 * 60-bar view is undefined for its first 49 bars, so zooming in would blank the
 * start of every moving average and change the values that remain.
 */
export function windowBounds(total: number, range: number, offset: number): [number, number] {
  if (range <= 0 || range >= total) return [0, total];
  const end = total - clampOffset(offset, total, range);
  return [Math.max(0, end - range), end];
}

/** The visible slice. `range <= 0` means "everything loaded", which cannot pan. */
export function windowOf<T>(bars: T[], range: number, offset: number): T[] {
  const [a, b] = windowBounds(bars.length, range, offset);
  return a === 0 && b === bars.length ? bars : bars.slice(a, b);
}

/**
 * Index of the bar nearest a timestamp. Binary search rather than a scan: this
 * runs for every endpoint of every drawing on every frame of a pan.
 */
export function nearestIndex(times: { t: number }[], t: number): number {
  if (!times.length) return 0;
  let lo = 0, hi = times.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid].t < t) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs(times[lo - 1].t - t) <= Math.abs(times[lo].t - t)) return lo - 1;
  return lo;
}

/**
 * Offset after a drag. Dragging to the RIGHT pulls older bars into view, which
 * is the direction every chart tool agrees on: the content follows the hand.
 */
export function offsetFromDrag(
  startOffset: number, dxPixels: number, band: number, total: number, range: number,
): number {
  const perBar = Math.max(band, 0.5); // a zero band would divide to Infinity
  return clampOffset(startOffset + dxPixels / perBar, total, range);
}


/** Fewer bars than this and the chart stops being a chart. */
export const MIN_RANGE = 20;

/** One wheel notch. Multiplicative so zooming feels the same at every scale. */
const ZOOM_STEP = 1.2;

/**
 * Zoom about a point.
 *
 * The bar under the cursor must stay under the cursor. Zooming about the centre
 * (or about the right edge) is the common shortcut and it is the thing that
 * makes a chart feel wrong: the reader points at a candle, scrolls, and the
 * candle they were reading slides out from under the pointer.
 *
 * `fraction` is where the pointer sits across the plot, 0 at the left edge and
 * 1 at the right. `direction` is +1 to zoom out (more bars) and -1 to zoom in.
 */
export function zoomAt(
  { total, range, offset, fraction, direction }: {
    total: number; range: number; offset: number; fraction: number; direction: 1 | -1;
  },
): { range: number; offset: number } {
  const cur = Math.min(range > 0 ? range : total, total);
  return rangeAt({
    total, range, offset, fraction,
    next: direction > 0 ? cur * ZOOM_STEP : cur / ZOOM_STEP,
  });
}

/**
 * Move to an arbitrary new range, keeping the bar under `fraction` in place.
 *
 * Shared by the wheel, the keyboard and pinch, so all three anchor identically.
 * A pinch that anchored differently from the wheel would feel like a different
 * chart depending on the input device.
 */
export function rangeAt(
  { total, range, offset, fraction, next: wanted }: {
    total: number; range: number; offset: number; fraction: number; next: number;
  },
): { range: number; offset: number } {
  // "Everything loaded" has to become a concrete count before it can be scaled.
  const cur = Math.min(range > 0 ? range : total, total);
  const safeOffset = clampOffset(offset, total, cur);
  const f = Math.min(1, Math.max(0, Number.isFinite(fraction) ? fraction : 0.5));

  const next = Number.isFinite(wanted)
    ? Math.min(total, Math.max(MIN_RANGE, Math.round(wanted)))
    : cur;
  if (next === cur) return { range: cur, offset: safeOffset };

  const start = total - cur - safeOffset;
  const anchor = start + f * cur;
  const nextStart = Math.round(anchor - f * next);
  return { range: next, offset: clampOffset(total - next - nextStart, total, next) };
}

/** Distance between two touch points, in pixels. */
export function spreadOf(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Pinch to zoom.
 *
 * Scaled against where the gesture STARTED rather than the previous frame, so
 * the range depends only on how far apart the fingers are now. Accumulating
 * per-frame ratios drifts: each frame rounds to a whole number of bars, and the
 * rounding error compounds until pinching out and back does not return the
 * reader to the range they began with.
 *
 * Fingers moving apart means zooming IN — fewer bars, each wider — which is the
 * direction every map and photo viewer agrees on.
 */
export function pinch(
  { total, startRange, startOffset, startSpread, spread, fraction }: {
    total: number; startRange: number; startOffset: number;
    startSpread: number; spread: number; fraction: number;
  },
): { range: number; offset: number } {
  const base = Math.min(startRange > 0 ? startRange : total, total);
  // A gesture that began with the fingers together has no scale to measure.
  if (!(startSpread > 0) || !(spread > 0)) {
    return { range: base, offset: clampOffset(startOffset, total, base) };
  }
  return rangeAt({
    total, range: startRange, offset: startOffset, fraction,
    next: base / (spread / startSpread),
  });
}
