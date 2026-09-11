/**
 * Chart geometry, written once and emitted twice.
 *
 * The same folded columns have to reach two destinations: SVG path data, which
 * the image export and the interaction suite read, and canvas drawing calls,
 * which is what makes a pan cheap. Two copies of the folding would drift, and a
 * canvas that folded differently from the SVG would draw one chart on screen
 * and export another. So the folding lives here, and a sink decides what each
 * segment becomes.
 */
import type { Bar } from "../types.ts";
import { decimate, type CandleGeom, type VolumeGeom } from "./paths.ts";

export interface PathSink {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  /** A vertical stroke at `x` from `y0` to `y1` — a wick. */
  vline(x: number, y0: number, y1: number): void;
  /** A closed rectangle — a body or a bar. */
  rect(x0: number, y0: number, x1: number, y1: number): void;
}

/**
 * SVG path data, formatted exactly as `paths.ts` always has — one decimal, the
 * same commands — so switching to this sink changes no byte of any chart.
 */
export class StringSink implements PathSink {
  d = "";
  moveTo(x: number, y: number) { this.d += `M${x.toFixed(1)},${y.toFixed(1)}`; }
  lineTo(x: number, y: number) { this.d += `L${x.toFixed(1)},${y.toFixed(1)}`; }
  vline(x: number, y0: number, y1: number) { this.d += `M${x.toFixed(1)},${y0.toFixed(1)}V${y1.toFixed(1)}`; }
  rect(x0: number, y0: number, x1: number, y1: number) {
    this.d += `M${x0.toFixed(1)},${y0.toFixed(1)}H${x1.toFixed(1)}V${y1.toFixed(1)}H${x0.toFixed(1)}Z`;
  }
}

/** Candles into four sinks. Returns the number of columns drawn. */
export function emitCandles(
  bars: Bar[], g: CandleGeom, maxColumns: number | undefined,
  s: { upWick: PathSink; downWick: PathSink; upBody: PathSink; downBody: PathSink },
): number {
  const dense = maxColumns !== undefined && bars.length > maxColumns;
  const cols = dense ? decimate(bars, maxColumns) : null;
  const n = cols ? cols.length : bars.length;
  for (let k = 0; k < n; k++) {
    const b = cols ? cols[k].bar : bars[k];
    const span = cols ? cols[k].span : 1;
    const cx = g.x(cols ? cols[k].i : k);
    // A folded column stands for `span` bars, so it fills their width.
    const half = (g.bodyWidth * span) / 2;
    const top = g.y(Math.max(b.o, b.c));
    // A doji has zero body height and would otherwise vanish entirely.
    const h = Math.max(1, Math.abs(g.y(b.o) - g.y(b.c)));
    const up = b.c >= b.o;
    (up ? s.upWick : s.downWick).vline(cx, g.y(b.h), g.y(b.l));
    (up ? s.upBody : s.downBody).rect(cx - half, top, cx + half, top + h);
  }
  return n;
}

/** Volume bars into two sinks. Returns the number of columns drawn. */
export function emitVolume(
  bars: Bar[], g: VolumeGeom, maxColumns: number | undefined,
  s: { up: PathSink; down: PathSink },
): number {
  const max = g.maxVolume || 1;
  const dense = maxColumns !== undefined && bars.length > maxColumns;
  const cols = dense ? decimate(bars, maxColumns) : null;
  const n = cols ? cols.length : bars.length;
  for (let k = 0; k < n; k++) {
    const b = cols ? cols[k].bar : bars[k];
    const span = cols ? cols[k].span : 1;
    // A folded column's volume is a SUM; the mean is what the eye compares.
    const h = Math.max(0.5, (b.v / span / max) * (g.height - 6));
    const cx = g.x(cols ? cols[k].i : k);
    const half = (g.barWidth * span) / 2;
    (b.c >= b.o ? s.up : s.down).rect(cx - half, g.height - h, cx + half, g.height);
  }
  return n;
}

/**
 * A line through a series with holes: a null lifts the pen, and a dense window
 * keeps each bucket's min and max in the order they happened, so no spike is lost.
 */
export function emitSeries(
  values: (number | null)[], x: (i: number) => number, y: (v: number) => number,
  maxColumns: number | undefined, s: PathSink,
): void {
  const n = values.length;
  if (n === 0) return;
  let penDown = false;
  const to = (i: number, v: number) => {
    if (penDown) s.lineTo(x(i), y(v)); else s.moveTo(x(i), y(v));
    penDown = true;
  };
  if (maxColumns === undefined || n <= maxColumns) {
    for (let i = 0; i < n; i++) {
      const v = values[i];
      if (v === null || !Number.isFinite(v)) { penDown = false; continue; }
      to(i, v);
    }
    return;
  }
  const step = Math.ceil(n / Math.max(1, Math.floor(maxColumns)));
  for (let start = 0; start < n; start += step) {
    const end = Math.min(n, start + step);
    let loI = -1, hiI = -1, lo = Infinity, hi = -Infinity;
    for (let k = start; k < end; k++) {
      const v = values[k];
      if (v === null || !Number.isFinite(v)) continue;
      if (v < lo) { lo = v; loI = k; }
      if (v > hi) { hi = v; hiI = k; }
    }
    if (loI === -1) { penDown = false; continue; }
    if (loI === hiI) { to(loI, lo); continue; }
    if (loI < hiI) { to(loI, lo); to(hiI, hi); } else { to(hiI, hi); to(loI, lo); }
  }
}

/** Signed bars about a baseline, folded to the bucket MEAN. */
export function emitSignedBars(
  values: (number | null)[],
  g: { x: (i: number) => number; y: (v: number) => number; zeroY: number; barWidth: number },
  maxColumns: number | undefined, s: { up: PathSink; down: PathSink },
): void {
  const n = values.length;
  if (n === 0) return;
  const dense = maxColumns !== undefined && n > maxColumns;
  const step = dense ? Math.ceil(n / Math.max(1, Math.floor(maxColumns as number))) : 1;
  for (let start = 0; start < n; start += step) {
    const end = Math.min(n, start + step);
    let sum = 0, count = 0;
    for (let k = start; k < end; k++) {
      const v = values[k];
      if (v === null || !Number.isFinite(v)) continue;
      sum += v; count++;
    }
    if (!count) continue;
    const v = sum / count;
    if (v === 0) continue;
    const cx = g.x(start + (end - start - 1) / 2);
    const half = (g.barWidth * (end - start)) / 2;
    const py = g.y(v);
    const top = Math.min(py, g.zeroY);
    const bottom = Math.max(py, g.zeroY);
    // A bar too short to see still has to be visible as activity.
    (v > 0 ? s.up : s.down).rect(cx - half, top, cx + half, Math.max(bottom, top + 0.5));
  }
}

/**
 * How many columns a window of `n` bars folds to under `maxColumns` — what the
 * emitters above draw, without drawing it. A canvas layer publishes this,
 * since it has no nodes for the interaction suite to count.
 */
export function columnsFor(n: number, maxColumns: number | undefined): number {
  if (n <= 0) return 0;
  if (maxColumns === undefined || n <= maxColumns) return n;
  const step = Math.ceil(n / Math.max(1, Math.floor(maxColumns)));
  return Math.ceil(n / step);
}
