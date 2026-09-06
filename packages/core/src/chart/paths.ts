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

/** One rectangle as a closed subpath. */
function rect(x0: number, y0: number, x1: number, y1: number): string {
  return `M${x0.toFixed(1)},${y0.toFixed(1)}H${x1.toFixed(1)}V${y1.toFixed(1)}H${x0.toFixed(1)}Z`;
}

export function candlePaths(bars: Bar[], g: CandleGeom): {
  upWick: string; downWick: string; upBody: string; downBody: string;
} {
  const out = { upWick: "", downWick: "", upBody: "", downBody: "" };
  const half = g.bodyWidth / 2;

  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    const cx = g.x(i);
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

export function volumePaths(bars: Bar[], g: VolumeGeom): { up: string; down: string } {
  const out = { up: "", down: "" };
  const half = g.barWidth / 2;
  const max = g.maxVolume || 1;

  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    const h = Math.max(0.5, (b.v / max) * (g.height - 6));
    const cx = g.x(i);
    const d = rect(cx - half, g.height - h, cx + half, g.height);
    if (b.c >= b.o) out.up += d; else out.down += d;
  }
  return out;
}
