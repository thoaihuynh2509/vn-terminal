import {
  emitCandles, emitSeries, emitSignedBars, emitVolume, type PathSink,
} from "@/lib/chart/geometry";
import type { CandleGeom, VolumeGeom } from "@/lib/chart/paths";
import type { Bar } from "@/lib/types";

/**
 * The dense chart layers as canvas calls.
 *
 * Each function draws what the matching SVG block drew — same folded columns
 * (the geometry is shared with `paths.ts`), same stroke widths, dashes,
 * opacities and fill/stroke pairs, in the same order — so moving a layer onto
 * canvas changes what it costs, not what it looks like.
 */

/** Geometry emitted straight into a Path2D: no string built, none parsed. */
class Path2DSink implements PathSink {
  p = new Path2D();
  moveTo(x: number, y: number) { this.p.moveTo(x, y); }
  lineTo(x: number, y: number) { this.p.lineTo(x, y); }
  vline(x: number, y0: number, y1: number) { this.p.moveTo(x, y0); this.p.lineTo(x, y1); }
  rect(x0: number, y0: number, x1: number, y1: number) { this.p.rect(x0, y0, x1 - x0, y1 - y0); }
}

const sink = () => new Path2DSink();

/** Hollow rising, filled falling — direction without relying on hue. Returns columns drawn. */
export function drawCandles(
  ctx: CanvasRenderingContext2D, bars: Bar[], g: CandleGeom, maxCols: number,
  c: { up: string; down: string; surface: string },
): number {
  const s = { upWick: sink(), downWick: sink(), upBody: sink(), downBody: sink() };
  const n = emitCandles(bars, g, maxCols, s);
  ctx.lineWidth = 1;
  ctx.strokeStyle = c.up; ctx.stroke(s.upWick.p);
  ctx.strokeStyle = c.down; ctx.stroke(s.downWick.p);
  ctx.fillStyle = c.surface; ctx.fill(s.upBody.p);
  ctx.strokeStyle = c.up; ctx.stroke(s.upBody.p);
  ctx.fillStyle = c.down; ctx.fill(s.downBody.p);
  ctx.strokeStyle = c.down; ctx.stroke(s.downBody.p);
  return n;
}

export function drawVolume(
  ctx: CanvasRenderingContext2D, bars: Bar[], g: VolumeGeom, maxCols: number,
  c: { up: string; down: string }, alpha: number,
): number {
  const s = { up: sink(), down: sink() };
  const n = emitVolume(bars, g, maxCols, s);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = c.up; ctx.fill(s.up.p);
  ctx.fillStyle = c.down; ctx.fill(s.down.p);
  ctx.restore();
  return n;
}

export interface LineStyle { color: string; width: number; dash?: number[]; alpha?: number; join?: CanvasLineJoin }

export function drawSeries(
  ctx: CanvasRenderingContext2D, values: (number | null)[],
  x: (i: number) => number, y: (v: number) => number, maxCols: number, st: LineStyle,
): void {
  const s = sink();
  emitSeries(values, x, y, maxCols, s);
  ctx.save();
  ctx.globalAlpha = st.alpha ?? 1;
  ctx.strokeStyle = st.color;
  ctx.lineWidth = st.width;
  ctx.lineJoin = st.join ?? "miter";
  ctx.setLineDash(st.dash ?? []);
  ctx.stroke(s.p);
  ctx.restore();
}

/** The close as a filled area under a line, closed down to `baseY`. */
export function drawArea(
  ctx: CanvasRenderingContext2D, values: (number | null)[],
  x: (i: number) => number, y: (v: number) => number, maxCols: number,
  baseY: number, color: string, alpha: number,
): void {
  const s = sink();
  emitSeries(values, x, y, maxCols, s);
  s.p.lineTo(x(values.length - 1), baseY);
  s.p.lineTo(x(0), baseY);
  s.p.closePath();
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.fill(s.p);
  ctx.restore();
}

export function drawSignedBars(
  ctx: CanvasRenderingContext2D, values: (number | null)[],
  g: { x: (i: number) => number; y: (v: number) => number; zeroY: number; barWidth: number },
  maxCols: number, c: { up: string; down: string }, alpha: number,
): void {
  const s = { up: sink(), down: sink() };
  emitSignedBars(values, g, maxCols, s);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = c.up; ctx.fill(s.up.p);
  ctx.fillStyle = c.down; ctx.fill(s.down.p);
  ctx.restore();
}

/** An SVG `stroke-dasharray` string as a canvas dash list. */
export function dashList(dash: string | undefined): number[] {
  return dash ? dash.trim().split(/[\s,]+/).map(Number).filter((n) => Number.isFinite(n)) : [];
}
