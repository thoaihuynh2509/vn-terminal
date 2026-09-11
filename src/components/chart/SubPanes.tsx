"use client";

import { useCallback, useMemo } from "react";
import { num, volume as fmtVol } from "@/lib/format";
import { COLOR_VAR, type IndicatorDef, type Plot } from "@/lib/ta/registry";
import { labelFor, shortFor } from "@/lib/ta/params";
import { PaneCanvas } from "./PaneCanvas";
import { PlotLayer } from "./panLayers";
import { CrosshairLine, useHoverIndex } from "./crosshair";
import { useChartColors } from "./chartColors";
import { drawSeries, drawSignedBars, drawVolume } from "./canvasLayers";
import { seriesPath, signedBarPaths, volumePaths } from "@/lib/chart/paths";
import { seriesExtent } from "@/lib/chart/scale";
import type { Locale } from "@/lib/types";
import { useChartSeries, type PaneGeom } from "./chartShared";

const NONE: (number | null)[] = [];

export function VolumePane({
  lead, bleedPx, drawCols, plotW, width, band, x, PAD, maxCols, locale,
}: PaneGeom & { locale: Locale }) {
  const H = 56;
  const { view, drawView } = useChartSeries();
  const xd = useCallback((j: number) => x(j - lead), [x, lead]);
  const colors = useChartColors();
  const maxV = useMemo(() => Math.max(seriesExtent([view.map((b) => b.v)]).hi, 1), [view]);
  // Held across renders so a crosshair move does not rebuild every bar; see PricePane.
  const barLayer = useMemo(() => {
    if (colors) return null;
    const p = volumePaths(view, {
      x, barWidth: Math.max(1, Math.min(band * 0.62, 14)), height: H, maxVolume: maxV,
    }, maxCols);
    return (
      <g opacity={0.32}>
        <path d={p.up} fill="var(--up)" />
        <path d={p.down} fill="var(--down)" />
      </g>
    );
  }, [colors, view, x, band, maxV, maxCols]);
  const drawBars = useCallback((ctx: CanvasRenderingContext2D) => {
    if (!colors) return;
    drawVolume(ctx, drawView, {
      x: xd, barWidth: Math.max(1, Math.min(band * 0.62, 14)), height: H, maxVolume: maxV,
    }, drawCols, colors, 0.32);
  }, [colors, drawView, xd, band, maxV, drawCols]);
  // After the hooks: returning above them would change the hook order.
  if (maxV <= 1) return null;
  return (
    <div className="relative">
      <PlotLayer left={PAD.left} width={plotW} height={H}>
        {colors && <PaneCanvas width={plotW + 2 * bleedPx} height={H} left={-bleedPx} originX={PAD.left - bleedPx} draw={drawBars} />}
      </PlotLayer>
      <svg width="100%" height={H} viewBox={`0 0 ${width} ${H}`} role="img" aria-label={`Volume`} className="relative block">
        {barLayer}
        <CrosshairLine x={x} height={H} length={view.length} />
        <text x={PAD.left} y={10} fontSize={9} fill="var(--muted)">VOL {fmtVol(maxV, locale)}</text>
      </svg>
    </div>
  );
}

/**
 * Foreign net buy/sell (khối ngoại), one signed bar per session about a zero
 * line: green above for a net-buy day, red below for a net-sell day. Its own
 * pane and its own scale — it never touches price. A missing session (null)
 * simply has no bar; nothing is drawn as a fake zero.
 */
export function ForeignPane({
  width, band, x, PAD, maxCols, label, lead, bleedPx, drawCols, plotW,
}: PaneGeom & { label: string; locale: Locale }) {
  const H = 54;
  const foreign = useChartSeries().foreign;
  const net = foreign?.net ?? NONE;
  const netDraw = foreign?.netDraw ?? NONE;
  const xd = useCallback((j: number) => x(j - lead), [x, lead]);
  const mid = H / 2;
  const colors = useChartColors();
  // The largest magnitude sits at one of the two extremes. An empty series is
  // 1, as `Math.max(1)` was — not the infinity an empty extent would give.
  const maxAbs = useMemo(() => {
    const e = seriesExtent([net]);
    return e.n ? Math.max(1, Math.abs(e.lo), Math.abs(e.hi)) : 1;
  }, [net]);
  const bw = Math.max(1, Math.min(band * 0.62, 14));
  // Held across renders so a crosshair move does not rebuild every bar; see PricePane.
  const barLayer = useMemo(() => {
    if (colors) return null;
    const p = signedBarPaths(net, {
      x, y: (v) => mid - (v / maxAbs) * (mid - 6), zeroY: mid, barWidth: bw,
    }, maxCols);
    return (
      <g opacity={0.55}>
        <path d={p.up} className="text-up" fill="currentColor" />
        <path d={p.down} className="text-down" fill="currentColor" />
      </g>
    );
  }, [colors, net, x, mid, maxAbs, bw, maxCols]);
  // The zero line goes with the bars, so it stays beneath them.
  const drawBars = useCallback((ctx: CanvasRenderingContext2D) => {
    if (!colors) return;
    ctx.lineWidth = 1;
    ctx.strokeStyle = colors.grid;
    ctx.beginPath(); ctx.moveTo(PAD.left - bleedPx, mid); ctx.lineTo(PAD.left + plotW + bleedPx, mid); ctx.stroke();
    drawSignedBars(ctx, netDraw, {
      x: xd, y: (v) => mid - (v / maxAbs) * (mid - 6), zeroY: mid, barWidth: bw,
    }, drawCols, colors, 0.55);
  }, [colors, PAD, plotW, bleedPx, mid, netDraw, xd, maxAbs, bw, drawCols]);
  return (
    <div className="relative">
      <PlotLayer left={PAD.left} width={plotW} height={H}>
        {colors && <PaneCanvas width={plotW + 2 * bleedPx} height={H} left={-bleedPx} originX={PAD.left - bleedPx} draw={drawBars} />}
      </PlotLayer>
      <svg width="100%" height={H} viewBox={`0 0 ${width} ${H}`} role="img" aria-label={label} className="relative block">
        {!colors && <line x1={PAD.left} x2={PAD.left + (width - PAD.left - PAD.right)} y1={mid} y2={mid} stroke="var(--grid)" strokeWidth={1} />}
        {barLayer}
        <CrosshairLine x={x} height={H} length={net.length} />
        <text x={PAD.left} y={10} fontSize={9} fill="var(--muted)">{label}</text>
      </svg>
    </div>
  );
}

/** Breadth is bounded 0–100, so its pane has a fixed height and a fixed scale. */
const BREADTH_H = 54;
const breadthY = (v: number) => 8 + (BREADTH_H - 16) - (v / 100) * (BREADTH_H - 16);

/**
 * Breadth, 0–100. Bounded, so the scale is fixed rather than fitted to the
 * window — a breadth chart that rescales itself makes 60% look like an extreme
 * on a quiet week. The 50 line is drawn because it is a genuine midpoint (half
 * the market participating), not a threshold someone picked.
 */
export function BreadthPane({
  width, x, PAD, maxCols, label, lead, bleedPx, drawCols, plotW,
}: PaneGeom & { label: string; locale: Locale }) {
  const H = BREADTH_H;
  const breadth = useChartSeries().breadth;
  const pct = breadth?.pct ?? NONE;
  const pctDraw = breadth?.pctDraw ?? NONE;
  const xd = useCallback((j: number) => x(j - lead), [x, lead]);
  const y = breadthY;
  const colors = useChartColors();
  // Held across renders so a crosshair move does not rebuild the line.
  const d = useMemo(() => (colors ? "" : seriesPath(pct, x, breadthY, maxCols)), [colors, pct, x, maxCols]);
  // The 50% line goes with the series, so it stays beneath it.
  const drawLine = useCallback((ctx: CanvasRenderingContext2D) => {
    if (!colors) return;
    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = colors.grid;
    ctx.setLineDash([2, 3]);
    ctx.beginPath(); ctx.moveTo(PAD.left - bleedPx, breadthY(50)); ctx.lineTo(PAD.left + plotW + bleedPx, breadthY(50)); ctx.stroke();
    ctx.restore();
    drawSeries(ctx, pctDraw, xd, breadthY, drawCols, { color: colors.accent, width: 1.5 });
  }, [colors, PAD, plotW, bleedPx, pctDraw, xd, drawCols]);
  const last = useMemo(() => [...pct].reverse().find((v): v is number => v !== null), [pct]);
  return (
    <div className="relative">
      <PlotLayer left={PAD.left} width={plotW} height={H}>
        {colors && <PaneCanvas width={plotW + 2 * bleedPx} height={H} left={-bleedPx} originX={PAD.left - bleedPx} draw={drawLine} />}
      </PlotLayer>
    <svg width="100%" height={H} viewBox={`0 0 ${width} ${H}`} role="img" aria-label={label} className="relative block">
      {!colors && <line x1={PAD.left} x2={PAD.left + plotW} y1={y(50)} y2={y(50)} stroke="var(--grid)" strokeWidth={1} strokeDasharray="2 3" />}
      {d && <path d={d} fill="none" stroke="var(--accent)" strokeWidth={1.5} />}
      <CrosshairLine x={x} height={H} length={pct.length} />
      <text x={PAD.left} y={10} fontSize={9} fill="var(--muted)">{label}</text>
      {last !== undefined && (
        <text x={PAD.left + plotW - 2} y={10} fontSize={9} textAnchor="end" fill="var(--muted)" className="tnum">
          {Math.round(last)}%
        </text>
      )}
    </svg>
    </div>
  );
}

export function OscillatorPane({
  def, period, plots, drawPlots, width, band, x, PAD, maxCols, locale, lead, bleedPx, drawCols, plotW,
}: PaneGeom & {
  def: IndicatorDef; period: number | null; plots: Plot[];
  /** `plots` over `drawView`: what is drawn, where `plots` sets the scale and the read-out. */
  drawPlots: Plot[]; locale: Locale;
}) {
  const H = 96;
  const xd = useCallback((j: number) => x(j - lead), [x, lead]);
  const colors = useChartColors();
  const e = useMemo(() => seriesExtent(plots.map((p) => p.series)), [plots]);
  const [lo, hi] = def.range ?? [e.lo, e.hi];
  const span = hi - lo || 1;
  const y = useCallback((v: number) => 14 + (H - 24) - ((v - lo) / span) * (H - 24), [lo, span]);
  const zeroY = lo < 0 && hi > 0 ? y(0) : H - 10;
  // Held across renders so a crosshair move does not rebuild every series; see PricePane.
  const plotLayer = useMemo(() => colors ? null : plots.map((p) => {
    if (p.style !== "histogram") {
      return (
        <path key={p.key} d={seriesPath(p.series, x, y, maxCols)}
          fill="none" stroke={COLOR_VAR[p.color]} strokeWidth={1.5} />
      );
    }
    // Two paths rather than one node per bar — the same cost the candle
    // paths were written to remove, which had survived in this pane.
    const h = signedBarPaths(p.series, {
      x, y, zeroY, barWidth: Math.max(1, Math.min(band, 10)),
    }, maxCols);
    return (
      <g key={p.key} opacity={0.45}>
        <path d={h.up} fill="var(--up)" />
        <path d={h.down} fill="var(--down)" />
      </g>
    );
  }), [colors, plots, x, y, zeroY, band, maxCols]);
  // Guides go with the plots, so they stay beneath them; their labels stay SVG.
  const drawPlotLines = useCallback((ctx: CanvasRenderingContext2D) => {
    if (!colors) return;
    ctx.lineWidth = 1;
    ctx.strokeStyle = colors.grid;
    for (const g of def.guides ?? []) {
      ctx.beginPath(); ctx.moveTo(PAD.left - bleedPx, y(g)); ctx.lineTo(PAD.left + plotW + bleedPx, y(g)); ctx.stroke();
    }
    for (const p of drawPlots) {
      if (p.style !== "histogram") drawSeries(ctx, p.series, xd, y, drawCols, { color: colors[p.color], width: 1.5 });
      else drawSignedBars(ctx, p.series, { x: xd, y, zeroY, barWidth: Math.max(1, Math.min(band, 10)) }, drawCols, colors, 0.45);
    }
  }, [colors, def.guides, PAD, plotW, bleedPx, y, drawPlots, xd, drawCols, zeroY, band]);
  // After the hooks: returning above them would change the hook order.
  if (!e.n) return null;

  return (
    <div className="relative border-t border-line">
      <PlotLayer left={PAD.left} width={plotW} height={H}>
        {colors && <PaneCanvas width={plotW + 2 * bleedPx} height={H} left={-bleedPx} originX={PAD.left - bleedPx} draw={drawPlotLines} />}
      </PlotLayer>
    <svg width="100%" height={H} viewBox={`0 0 ${width} ${H}`} role="img" aria-label={labelFor(def, period)} className="relative block">
      {/* The plot labels already name the indicator; printing `def.short` too
          produced "RSI RSI 14". */}
      <OscReadout plots={plots} def={def} period={period} locale={locale} x={PAD.left} />

      {(def.guides ?? []).map((g) => (
        <g key={g}>
          {!colors && <line x1={PAD.left} x2={width - PAD.right} y1={y(g)} y2={y(g)} stroke="var(--grid)" strokeWidth={1} />}
          <text x={width - PAD.right + 6} y={y(g) + 3} fontSize={9} fill="var(--muted)" className="tnum">{g}</text>
        </g>
      ))}

      {plotLayer}

      <CrosshairLine x={x} height={H} length={plots[0]?.series.length ?? 0} />
    </svg>
    </div>
  );
}

/** An oscillator's values at the crosshair, else at the last bar. */
function OscReadout({ plots, def, period, locale, x }: {
  plots: Plot[]; def: IndicatorDef; period: number | null; locale: Locale; x: number;
}) {
  const n = plots[0]?.series.length ?? 0;
  const idx = useHoverIndex(n) ?? n - 1;
  return (
    <text x={x} y={11} fontSize={10} fill="var(--muted)">
      {plots
        .map((p) => (p.series[idx] === null ? null : `${p.label} ${num(p.series[idx]!, locale, 2)}`))
        .filter(Boolean)
        .join("   ") || shortFor(def, period)}
    </text>
  );
}
