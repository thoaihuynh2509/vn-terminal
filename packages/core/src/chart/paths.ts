import type { Bar } from "@/lib/types";

/**
 * Candle and volume geometry as PATH data.
 *
 * A chart drawn as one element per bar costs three SVG nodes per candle plus one
 * per volume bar — around five hundred nodes for a normal window. Every pan
 * frame then makes React diff and rewrite every one of their attributes, which a
 * CPU profile showed dominating the interaction. Collapsing each visual class
 * into a single `<path>` turns that into four nodes and one attribute write.
 *
 * The visual is unchanged, including the hollow-up / filled-down encoding that
 * carries direction without relying on hue.
 */

export interface CandleGeom {
  x: (i: number) => number;
  y: (v: number) => number;
  bodyWidth: number;
}

/**
 * Fewest CSS pixels a drawn column may occupy.
 *
 * Not a pixel-sharing argument: on a 2× screen 1.5 CSS px is three device
 * pixels, so columns that narrow do resolve. The limit is what reads as a
 * candle — a body under about a pixel and a half, plus its gap, is a smudge,
 * not a bar a reader can pick out. Folding below that costs nothing visible,
 * because `decimate` keeps each bucket's true high and low.
 *
 * It is also the one lever that shrinks the cost of a PAN, since every pane's
 * path work scales with the column count and memoisation cannot help a window
 * that moves every frame. Raised from 1.5, measured in `cdp.mjs perf`.
 */
export const MIN_COLUMN_PX = 2.5;

/** How many columns a plot that wide can actually resolve. */
export function maxColumnsFor(plotWidth: number): number {
  return Math.max(1, Math.floor(plotWidth / MIN_COLUMN_PX));
}

/** One drawn column, standing for `span` consecutive bars. */
export interface BarBucket {
  bar: Bar;
  /** Where to draw it, in ORIGINAL index space — the bucket's centre. */
  i: number;
  span: number;
}

/**
 * Fold bars into at most `maxOut` columns.
 *
 * This is the same operation as switching to a coarser interval — open of the
 * first bar, close of the last, the true high and the true low, volume summed —
 * so a decimated column is a real OHLC bar for the span it covers, not a
 * sample. That matters: min and max are preserved exactly, so no spike, gap or
 * limit-move can vanish because the window got wide. Picking every Nth bar
 * would be cheaper and would quietly delete exactly the bars a trader is
 * looking for.
 *
 * Rendering only. Hover, the readout, drawings and alerts continue to address
 * real bars, so nothing the reader can click ever becomes an aggregate.
 */
export function decimate(bars: Bar[], maxOut: number): BarBucket[] {
  const n = bars.length;
  if (n === 0) return [];
  const cap = Math.max(1, Math.floor(maxOut));
  if (n <= cap) return bars.map((bar, i) => ({ bar, i, span: 1 }));

  const step = Math.ceil(n / cap);
  const out: BarBucket[] = [];
  for (let start = 0; start < n; start += step) {
    const end = Math.min(n, start + step);
    const first = bars[start];
    let h = first.h, l = first.l, v = 0;
    for (let k = start; k < end; k++) {
      const b = bars[k];
      if (b.h > h) h = b.h;
      if (b.l < l) l = b.l;
      v += b.v;
    }
    out.push({
      bar: { t: first.t, o: first.o, h, l, c: bars[end - 1].c, v },
      i: start + (end - start - 1) / 2,
      span: end - start,
    });
  }
  return out;
}

/** One rectangle as a closed subpath. */
function rect(x0: number, y0: number, x1: number, y1: number): string {
  return `M${x0.toFixed(1)},${y0.toFixed(1)}H${x1.toFixed(1)}V${y1.toFixed(1)}H${x0.toFixed(1)}Z`;
}

export function candlePaths(bars: Bar[], g: CandleGeom, maxColumns?: number): {
  upWick: string; downWick: string; upBody: string; downBody: string;
} {
  const out = { upWick: "", downWick: "", upBody: "", downBody: "" };

  // The common case allocates nothing: only a window too dense to resolve pays
  // for the bucket objects.
  const dense = maxColumns !== undefined && bars.length > maxColumns;
  const cols: BarBucket[] | null = dense ? decimate(bars, maxColumns) : null;
  const n = cols ? cols.length : bars.length;

  for (let k = 0; k < n; k++) {
    const b = cols ? cols[k].bar : bars[k];
    const span = cols ? cols[k].span : 1;
    const cx = g.x(cols ? cols[k].i : k);
    // A folded column stands for `span` bars, so it fills their width — the
    // wall of candles keeps its density instead of turning into a comb.
    const half = (g.bodyWidth * span) / 2;
    const wick = `M${cx.toFixed(1)},${g.y(b.h).toFixed(1)}V${g.y(b.l).toFixed(1)}`;
    const top = g.y(Math.max(b.o, b.c));
    // A doji has zero body height and would otherwise vanish entirely.
    const h = Math.max(1, Math.abs(g.y(b.o) - g.y(b.c)));
    const body = rect(cx - half, top, cx + half, top + h);

    if (b.c >= b.o) { out.upWick += wick; out.upBody += body; }
    else { out.downWick += wick; out.downBody += body; }
  }
  return out;
}

export interface VolumeGeom {
  x: (i: number) => number;
  barWidth: number;
  height: number;
  maxVolume: number;
}

export function volumePaths(bars: Bar[], g: VolumeGeom, maxColumns?: number): { up: string; down: string } {
  const out = { up: "", down: "" };
  const max = g.maxVolume || 1;

  const dense = maxColumns !== undefined && bars.length > maxColumns;
  const cols: BarBucket[] | null = dense ? decimate(bars, maxColumns) : null;
  const n = cols ? cols.length : bars.length;

  for (let k = 0; k < n; k++) {
    const b = cols ? cols[k].bar : bars[k];
    const span = cols ? cols[k].span : 1;
    // Bucket volume is the SUM of the bars it covers, so a folded column would
    // tower over an unfolded one; the mean is what the eye should compare.
    const h = Math.max(0.5, (b.v / span / max) * (g.height - 6));
    const cx = g.x(cols ? cols[k].i : k);
    const half = (g.barWidth * span) / 2;
    const d = rect(cx - half, g.height - h, cx + half, g.height);
    if (b.c >= b.o) out.up += d; else out.down += d;
  }
  return out;
}

/**
 * A line through a series that may have holes.
 *
 * Shared by the close line, the indicator overlays and the compare series,
 * which each grew their own copy of this map/filter/join. Two behaviours the
 * copies got wrong and this does not:
 *
 * 1. A `null` BREAKS the line. The old form dropped nulls and joined what was
 *    left, drawing a straight segment across a gap — an indicator with missing
 *    days looked like it had values there.
 * 2. Dense windows decimate to the min and the max of each bucket, in the order
 *    they occur, so the envelope of the line is preserved exactly. Sampling
 *    every Nth point would clip the spikes off an RSI.
 */
export function seriesPath(
  values: (number | null)[],
  x: (i: number) => number,
  y: (v: number) => number,
  maxColumns?: number,
): string {
  const n = values.length;
  if (n === 0) return "";

  let d = "";
  let penDown = false;
  const lineTo = (i: number, v: number) => {
    d += `${penDown ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
    penDown = true;
  };

  if (maxColumns === undefined || n <= maxColumns) {
    for (let i = 0; i < n; i++) {
      const v = values[i];
      if (v === null || !Number.isFinite(v)) { penDown = false; continue; }
      lineTo(i, v);
    }
    return d;
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
    // A bucket with no value at all is a real hole: lift the pen.
    if (loI === -1) { penDown = false; continue; }
    if (loI === hiI) { lineTo(loI, lo); continue; }
    // Emit in the order they happened so the line never doubles back.
    if (loI < hiI) { lineTo(loI, lo); lineTo(hiI, hi); }
    else { lineTo(hiI, hi); lineTo(loI, lo); }
  }
  return d;
}

/**
 * Signed bars about a baseline — foreign net flow, MACD-style histograms.
 *
 * These panes rendered one `<rect>` per bar, which is the very cost the candle
 * paths above were written to remove: at a wide window that is thousands of DOM
 * nodes whose attributes React re-diffs on every pan frame. Two paths replace
 * them, split by sign so each keeps its own fill.
 *
 * `y` maps a value to a pixel; `zeroY` is the baseline the bars stand on.
 * A dense window folds to the bucket MEAN, like volume: summing would make one
 * folded column tower over its unfolded neighbours and misstate the scale.
 */
export function signedBarPaths(
  values: (number | null)[],
  g: { x: (i: number) => number; y: (v: number) => number; zeroY: number; barWidth: number },
  maxColumns?: number,
): { up: string; down: string } {
  const out = { up: "", down: "" };
  const n = values.length;
  if (n === 0) return out;

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
    const d = rect(cx - half, top, cx + half, Math.max(bottom, top + 0.5));
    if (v > 0) out.up += d; else out.down += d;
  }
  return out;
}
