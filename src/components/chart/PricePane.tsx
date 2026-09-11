"use client";

import { useCallback, useMemo } from "react";
import { num } from "@/lib/format";
import type { Dict } from "@/lib/i18n";
import { COLOR_VAR, type Plot } from "@/lib/ta/registry";
import { PaneCanvas } from "./PaneCanvas";
import { useChartColors } from "./chartColors";
import { dashList, drawArea, drawCandles, drawSeries } from "./canvasLayers";
import { columnsFor } from "@/lib/chart/geometry";
import { anchorsOf, channelParallel, fibLevels, trendPriceAt, type Drawing, type DrawingKind } from "@/lib/chart/drawings";
import { nearestIndex } from "@/lib/chart/pan";
import { isSettled, settlementDate, unrealisedPct } from "@/lib/chart/settlement";
import { EVENT_GLYPH, placeEvents, type CorpEvent } from "@/lib/chart/events";
import { candlePaths, seriesPath } from "@/lib/chart/paths";
import { norm, pctOf, scaleTicks, type ScaleId, seriesExtent } from "@/lib/chart/scale";
import { dashFor } from "@/lib/chart/compare";
import type { PriceAlert } from "@/lib/alerts/alerts";
import type { Locale } from "@/lib/types";
import { type ChartType, TOOL_POINTS, stamp, type PaneGeom, type RefLine } from "./chartShared";

/** Legend keys that mirror the dash patterns, so the mapping survives greyscale. */
function dashGlyph(i: number): string {
  return ["┄", "┈", "┅"][i % 3];
}

export function PricePane({
  view, width, plotW, band, x, PAD, maxCols, type, overlays, hover, idx, locale, digits, symbol, dict, intraday,
  drawings, pending, mode, onClick, onMove, onLeave, onKey, onUp, canPan, H,
  refLines, alerts, compareView, cursorY, events, geom, selectedId,
}: PaneGeom & {
  H: number; plotW: number; type: ChartType; overlays: Plot[]; idx: number; locale: Locale; digits: number;
  symbol: string; dict: Dict;
  refLines: RefLine[]; alerts: PriceAlert[]; events: CorpEvent[];
  /** The parent's `priceGeom`: the one price domain every layer maps through. */
  geom: { sc: ScaleId; yMin: number; yMax: number };
  selectedId: string | null;
  compareView: { label: string; series: (number | null)[] }[];
  cursorY: number | null;
  drawings: Drawing[]; pending: { t: number; p: number }[]; mode: "cursor" | DrawingKind;
  onClick: (e: React.PointerEvent<SVGSVGElement>) => void;
  onMove: (e: React.PointerEvent<SVGSVGElement>) => void; onLeave: () => void;
  onUp: (e: React.PointerEvent<SVGSVGElement>) => void; canPan: boolean;
  onKey: (e: React.KeyboardEvent<SVGSVGElement>) => void;
}) {
  // The domain comes from the parent's `priceGeom`. This pane used to fold the
  // same bars, overlays and levels a second time on every render — with spread
  // arguments, tens of thousands of them at "Tất cả" — to reach identical numbers.
  const { sc, yMin, yMax } = geom;
  // Null until the client can read computed styles. The server render and the
  // hydration render therefore draw the dense layers as SVG — a chart arrives
  // with its candles before any script runs, and hydration cannot mismatch —
  // and canvas takes over the moment the colours resolve.
  const colors = useChartColors();
  const onCanvas = colors !== null;
  // Percent change is measured from the first VISIBLE bar, so panning moves the
  // baseline — which is what "how far has it come" means for the window a
  // reader is actually looking at. Never empty here: the parent renders no
  // panes for an empty window.
  const base = view[0].c;
  // One mapping for candles, drawings, alert levels, reference lines and the
  // crosshair, so switching the axis cannot move some of them and not others.
  const y = useCallback((v: number) => 10 + (H - 20) - norm(sc, v, yMin, yMax) * (H - 20), [sc, yMin, yMax, H]);

  // Compare line: its OWN min/max mapped to the pane's pixel band, so it shows
  // relative SHAPE without touching the price scale, candles or crosshair.
  // Each overlay is normalised against ITS OWN range and mapped to the pane's
  // pixel band, so relative SHAPE is comparable even when an index at 1,300 and
  // a share at 27 sit on the chart together — and none of them touch the price
  // scale, the candles or the crosshair.

  const compareScaled = useMemo(() => compareView.map((c) => {
    const e = seriesExtent([c.series]);
    const lo = e.n ? e.lo : 0;
    const hi = e.n ? e.hi : 1;
    const cy = (v: number) => 10 + (H - 20) - ((v - lo) / ((hi - lo) || 1)) * (H - 20);
    return { label: c.label, series: c.series, cy };
    // A series with no finite value draws nothing, and is not named in the legend.
  }).filter((c) => c.series.some((v) => v !== null && Number.isFinite(v))), [compareView, H]);
  const comparePaths = useMemo(
    () => (onCanvas ? [] : compareScaled.map((c) => ({ label: c.label, d: seriesPath(c.series, x, c.cy, maxCols) }))),
    [onCanvas, compareScaled, x, maxCols],
  );


  /**
   * Marker placements, held across renders.
   *
   * This was computed inline in the markup, so it re-derived a day key for
   * every visible bar on every render — and a pan renders on every frame. The
   * placements only change when the window or the event list does.
   */
  const placedEvents = useMemo(() => placeEvents(view, events), [view, events]);

  /**
   * The price pane's dense layer on canvas, in the order the SVG drew it: grid,
   * series, indicator overlays, compare lines. Only geometry moves here; labels,
   * levels, drawings and the crosshair stay in the SVG above it.
   */
  const drawPrice = useCallback((ctx: CanvasRenderingContext2D) => {
    if (!colors) return;
    ctx.lineWidth = 1;
    ctx.strokeStyle = colors.grid;
    for (const v of scaleTicks(sc, yMin, yMax)) {
      ctx.beginPath(); ctx.moveTo(PAD.left, y(v)); ctx.lineTo(PAD.left + plotW, y(v)); ctx.stroke();
    }
    if (type === "candle") {
      drawCandles(ctx, view, { x, y, bodyWidth: Math.max(1, Math.min(band * 0.62, 14)) }, maxCols, colors);
    } else {
      const closes = view.map((b) => b.c);
      if (type === "area") drawArea(ctx, closes, x, y, maxCols, H - 10, colors.accent, 0.10);
      drawSeries(ctx, closes, x, y, maxCols, { color: colors.accent, width: 2, join: "round" });
    }
    for (const o of overlays) {
      const isBand = o.style === "band";
      drawSeries(ctx, o.series, x, y, maxCols, {
        color: colors[o.color], width: isBand ? 1 : 1.5, dash: isBand ? [3, 3] : undefined, alpha: isBand ? 0.8 : 1,
      });
    }
    compareScaled.forEach((c, i) => drawSeries(ctx, c.series, x, c.cy, maxCols, {
      color: colors.muted, width: 1.5, dash: dashList(dashFor(i)), alpha: 0.85,
    }));
  }, [colors, sc, yMin, yMax, PAD, y, plotW, type, view, x, band, maxCols, H, overlays, compareScaled]);

  /**
   * The pane's geometry, held across renders as ready-made elements.
   *
   * A crosshair move re-renders this pane on every pointer event, and nothing
   * below depends on the crosshair — yet every path string was rebuilt each
   * time: at "Tất cả" with every indicator on, on the order of a megabyte of
   * path data per pointer move. When a memo hands back the SAME element object,
   * React skips reconciling that subtree: no rebuild, no attribute writes, same
   * DOM, same pixels. What keeps it honest: nothing here may depend on `hover`,
   * `cursorY` or `idx` — those stay live in the markup below.
   */
  const gridLayer = useMemo(() => (
    <>
      {scaleTicks(sc, yMin, yMax).map((v) => (
        <g key={v}>
          {!onCanvas && <line x1={PAD.left} x2={PAD.left + plotW} y1={y(v)} y2={y(v)} stroke="var(--grid)" strokeWidth={1} />}
          {/* On a percent axis the reader asked for distance travelled, so
              that is what the axis prints — signed, and glyphed like every
              other direction in this app. */}
          <text x={PAD.left + plotW + 6} y={y(v) + 3.5} fontSize={10} fill="var(--muted)" className="tnum">
            {sc === "pct"
              ? `${pctOf(v, base) >= 0 ? "+" : ""}${num(pctOf(v, base), locale, 1)}%`
              : num(v, locale, digits)}
          </text>
        </g>
      ))}
    </>
  ), [onCanvas, sc, yMin, yMax, y, plotW, base, locale, digits, PAD]);
  const seriesLayer = useMemo(() => {
    if (onCanvas) return null;
    // Only built when it is drawn: in candle mode this was a full pass over
    // every visible bar whose result was thrown away.
    const linePath = type === "line" || type === "area" ? seriesPath(view.map((b) => b.c), x, y, maxCols) : "";
    return (
      <>
    {type === "area" && (
      <path
        d={`${linePath} L${x(view.length - 1)},${H - 10} L${x(0)},${H - 10} Z`}
        fill="var(--accent)" opacity={0.10}
      />
    )}
    {(type === "line" || type === "area") && (
      <path d={linePath} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" />
    )}
    {/* Four paths rather than three nodes per candle. hollow = up,
        filled = down: direction without relying on hue. */}
    {type === "candle" && (() => {
      const p = candlePaths(view, { x, y, bodyWidth: Math.max(1, Math.min(band * 0.62, 14)) }, maxCols);
      return (
        <g>
          <path d={p.upWick} stroke="var(--up)" strokeWidth={1} fill="none" />
          <path d={p.downWick} stroke="var(--down)" strokeWidth={1} fill="none" />
          <path d={p.upBody} fill="var(--surface)" stroke="var(--up)" strokeWidth={1} />
          <path d={p.downBody} fill="var(--down)" stroke="var(--down)" strokeWidth={1} />
        </g>
      );
    })()}
      </>
    );
  }, [onCanvas, type, view, x, y, band, maxCols, H]);
  const overlayLayer = useMemo(() => onCanvas ? null : (
    <>
      {overlays.map((o) => {
        const d = seriesPath(o.series, x, y, maxCols);
        return (
          <path key={o.key} d={d} fill="none" stroke={COLOR_VAR[o.color]}
            strokeWidth={o.style === "band" ? 1 : 1.5} strokeDasharray={o.style === "band" ? "3 3" : undefined}
            opacity={o.style === "band" ? 0.8 : 1} />
        );
      })}
    </>
  ), [onCanvas, overlays, x, y, maxCols]);
  const refLayer = useMemo(() => (
    <>
      {/* VN ceiling/floor reference levels (trần/sàn), on the price scale. */}
      {refLines.map((r) => (
        <g key={r.label}>
          <line
            x1={PAD.left} x2={PAD.left + plotW} y1={y(r.price)} y2={y(r.price)}
            className={r.dir === "up" ? "text-up" : "text-down"}
            stroke="currentColor" strokeWidth={1} strokeDasharray="2 4" opacity={0.7}
          />
          <text
            x={PAD.left + 4} y={y(r.price) - 3} fontSize={10}
            className={`tnum ${r.dir === "up" ? "text-up" : "text-down"}`} fill="currentColor"
          >
            {r.label} {num(r.price, locale, digits)}
          </text>
        </g>
      ))}
    </>
  ), [refLines, y, plotW, locale, digits, PAD]);
  const alertLayer = useMemo(() => (
    <>
      {/* Armed price alerts, so the chart shows what it is watching for.
          Deliberately NOT folded into the price domain the way ceiling/floor
          are: an alert set far from the current price would squash every
          candle into a band to keep a line visible that the reader already
          knows about. One outside the visible range is simply not drawn. */}
      {alerts.map((a) => {
        if (a.price < yMin || a.price > yMax) return null;
        const rising = a.condition === "above" || a.condition === "cross_up";
        return (
          <g key={a.id} opacity={a.triggeredAt ? 0.45 : 0.9}>
            <line
              x1={PAD.left} x2={PAD.left + plotW} y1={y(a.price)} y2={y(a.price)}
              stroke="var(--accent)" strokeWidth={1} strokeDasharray="1 5"
            />
            {/* The glyph carries the direction, so the level is not colour-alone. */}
            <text
              x={PAD.left + plotW - 4} y={y(a.price) - 3} fontSize={10} textAnchor="end"
              className="tnum" fill="var(--accent)"
            >
              {rising ? "▲" : "▼"} {num(a.price, locale, digits)}
            </text>
          </g>
        );
      })}
    </>
  ), [alerts, y, yMin, yMax, plotW, locale, digits, PAD]);
  const compareLayer = useMemo(() => (
    <>
      {/* Overlays: normalised shape only, never the price scale. Each gets its
          own dash pattern so they are told apart without relying on colour,
          and the legend repeats that pattern rather than a colour swatch. */}
      {comparePaths.map((c, i) => (
        <path key={c.label} d={c.d} fill="none" stroke="var(--muted)" strokeWidth={1.5}
          strokeDasharray={dashFor(i)} opacity={0.85} />
      ))}
      {compareScaled.length > 0 && (
        <text x={PAD.left + 4} y={H - 8} fontSize={10} fill="var(--muted)">
          {compareScaled.map((c, i) => `${i === 0 ? "" : "   "}${dashGlyph(i)} ${c.label}`).join("")}
        </text>
      )}
    </>
  ), [comparePaths, compareScaled, H, PAD]);
  const eventLayer = useMemo(() => (
    <>
      {/* Corporate events on the session they went ex.

          Deliberately understated: a dotted riser and a lettered badge on the
          axis, never a band across the plot. The series is back-adjusted, so
          there is no gap here for a dividend to explain — the marker answers
          "was I holding when this paid, and how much", and the label says the
          amount without implying it caused anything. */}
      {placedEvents.map((ev) => {
        const cx = x(ev.i);
        const label = ev.kind === "cash" ? dict.chart.eventCash
          : ev.kind === "stock" ? dict.chart.eventStock : dict.chart.eventRights;
        const amount = ev.cash !== null
          ? ` · ${num(ev.cash, locale, 0)} ₫/cp`
          : ev.ratio !== null ? ` · ${num(ev.ratio, locale, 1)}%` : "";
        return (
          <g key={`${ev.exDate}-${ev.kind}-${ev.cash ?? ""}`}>
            <title>{`${label}${amount} · ${dict.chart.eventExDate} ${ev.exDate}${ev.note ? ` · ${ev.note}` : ""}`}</title>
            <line x1={cx} x2={cx} y1={H - 22} y2={H - 12}
              stroke="var(--muted)" strokeWidth={1} strokeDasharray="1 2" opacity={0.8} />
            <circle cx={cx} cy={H - 7} r={6} fill="var(--surface-2)" stroke="var(--muted)" strokeWidth={0.75} />
            {/* A letter, not a colour: D/S/R survive greyscale and colour blindness. */}
            <text x={cx} y={H - 4} fontSize={8} textAnchor="middle" fill="var(--ink-2)" fontWeight={600}>
              {EVENT_GLYPH[ev.kind]}
            </text>
          </g>
        );
      })}
    </>
  ), [placedEvents, x, H, dict, locale]);
  const tradeLayer = useMemo(() => (
    <>
      {/* Trade markers: an entry level, a marker at the session the shares
          become sellable (VN settles T+2, credited after lunch — "T+2.5"),
          and the unrealised move. No global tool models this, and it is the
          first thing a VN holder wants from a chart of something they own. */}
      {drawings.map((d) => {
        if (d.kind !== "trade") return null;
        const yEntry = y(d.price);
        if (!Number.isFinite(yEntry)) return null;
        const last = view[view.length - 1]?.c ?? d.price;
        const move = unrealisedPct(d.price, last);
        const settleAt = settlementDate(d.t);
        const settled = isSettled(d.t, view[view.length - 1]?.t ?? d.t);
        const iEntry = nearestIndex(view, d.t);
        const iSettle = nearestIndex(view, settleAt);
        return (
          <g key={d.id}>
            <line x1={PAD.left} x2={PAD.left + plotW} y1={yEntry} y2={yEntry}
              stroke="var(--ink-2)" strokeWidth={1} strokeDasharray="6 2" opacity={0.8} />
            {/* Where the position was opened. */}
            <path d={`M${x(iEntry)},${yEntry - 5} L${x(iEntry) + 5},${yEntry} L${x(iEntry)},${yEntry + 5} L${x(iEntry) - 5},${yEntry} Z`}
              fill="var(--ink-2)" />
            {/* Until this line the shares cannot be sold at all. Solid once
                they have settled, dashed while they are still locked. */}
            {iSettle > iEntry && (
              <line x1={x(iSettle)} x2={x(iSettle)} y1={8} y2={H - 8}
                stroke="var(--ink-2)" strokeWidth={1}
                strokeDasharray={settled ? undefined : "2 4"} opacity={0.55} />
            )}
            {/* Signed and glyphed, so the move never rides on colour alone. */}
            <text x={PAD.left + 4} y={yEntry - 4} fontSize={10} className="tnum"
              fill="var(--ink-2)">
              {move >= 0 ? "▲" : "▼"} {move >= 0 ? "+" : ""}{num(move, locale, 2)}% · {num(d.price, locale, digits)}
            </text>
          </g>
        );
      })}
    </>
  ), [drawings, view, x, y, plotW, H, locale, digits, PAD]);
  const drawingLayer = useMemo(() => (
    <>
      {/* Drawings map from data space through the same scales as the bars,
          so they stay pinned when the range changes. */}
      {drawings.map((d) => {
        if (d.kind === "hline") {
          return (
            <g key={d.id}>
              <line x1={PAD.left} x2={PAD.left + plotW} y1={y(d.price)} y2={y(d.price)}
                stroke="var(--accent)" strokeWidth={1} strokeDasharray="4 3" />
              <text x={PAD.left + plotW + 6} y={y(d.price) + 3.5} fontSize={10} fill="var(--accent)" className="tnum">
                {num(d.price, locale, digits)}
              </text>
            </g>
          );
        }
        // Binary search, not a scan: this runs for every endpoint of every
        // drawing on every frame of a pan.
        const iOf = (t: number) => nearestIndex(view, t);
        if (d.kind === "trade") return null; // drawn separately, below

        // A moment worth marking, with no price of its own.
        if (d.kind === "vline") {
          return (
            <line key={d.id} x1={x(iOf(d.t))} x2={x(iOf(d.t))} y1={8} y2={H - 8}
              stroke="var(--accent)" strokeWidth={1} strokeDasharray="4 3" />
          );
        }

        // A note anchored to a bar and a price, so it travels with the data.
        if (d.kind === "text") {
          const tx = x(iOf(d.t)), ty = y(d.price);
          return (
            <g key={d.id}>
              <circle cx={tx} cy={ty} r={2.5} fill="var(--accent)" />
              <text x={tx + 5} y={ty - 4} fontSize={11} fill="var(--accent)">{d.text}</text>
            </g>
          );
        }

        const i1 = iOf(d.t1), i2 = iOf(d.t2);

        // A box over a region: a range, a consolidation, an event window.
        if (d.kind === "rect") {
          const x1 = Math.min(x(i1), x(i2)), x2 = Math.max(x(i1), x(i2));
          const y1 = Math.min(y(d.p1), y(d.p2)), y2 = Math.max(y(d.p1), y(d.p2));
          return (
            <rect key={d.id} x={x1} y={y1} width={Math.max(1, x2 - x1)} height={Math.max(1, y2 - y1)}
              fill="var(--accent)" fillOpacity={0.08} stroke="var(--accent)" strokeWidth={1} />
          );
        }

        // A ray keeps going past its second point, which is the whole reason
        // a reader picks one over a segment.
        if (d.kind === "ray") {
          const last = view.length - 1;
          const endT = view[last].t;
          // Extended along its own slope to the right edge rather than to the
          // second point, so the line stays true as the window moves.
          const endP = trendPriceAt(d, Math.max(endT, d.t2));
          const xEnd = x(Math.max(i2, last));
          return (
            <g key={d.id}>
              <line x1={x(i1)} y1={y(d.p1)} x2={xEnd} y2={y(endP)} stroke="var(--accent)" strokeWidth={1.5} />
              <circle cx={x(i1)} cy={y(d.p1)} r={3} fill="var(--accent)" />
            </g>
          );
        }

        // A measurement states what it measured: price move, percent, and how
        // many sessions it took — the three numbers the tool exists for.
        if (d.kind === "measure") {
          const dp = d.p2 - d.p1;
          const pctMove = d.p1 ? (dp / d.p1) * 100 : 0;
          const bars = Math.abs(i2 - i1);
          const mx = (x(i1) + x(i2)) / 2;
          const my = Math.min(y(d.p1), y(d.p2)) - 6;
          return (
            <g key={d.id}>
              <rect x={Math.min(x(i1), x(i2))} y={Math.min(y(d.p1), y(d.p2))}
                width={Math.max(1, Math.abs(x(i2) - x(i1)))} height={Math.max(1, Math.abs(y(d.p2) - y(d.p1)))}
                fill={dp >= 0 ? "var(--up)" : "var(--down)"} fillOpacity={0.10} />
              <line x1={x(i1)} y1={y(d.p1)} x2={x(i2)} y2={y(d.p2)}
                stroke="var(--ink-2)" strokeWidth={1} strokeDasharray="3 2" />
              <text x={mx} y={my} fontSize={10} textAnchor="middle" className="tnum" fill="var(--ink-2)">
                {dp >= 0 ? "▲" : "▼"} {dp >= 0 ? "+" : ""}{num(dp, locale, digits)} ({dp >= 0 ? "+" : ""}{num(pctMove, locale, 2)}%) · {bars}
              </text>
            </g>
          );
        }

        if (d.kind === "channel") {
          const par = channelParallel(d);
          const ya = y(trendPriceAt(d, view[i1].t)), yb = y(trendPriceAt(d, view[i2].t));
          const pa = y(trendPriceAt(par, view[i1].t)), pb = y(trendPriceAt(par, view[i2].t));
          const i3 = iOf(d.t3);
          return (
            <g key={d.id}>
              {/* The band is what a channel is FOR — the two lines alone leave
                  the reader to infer which side of each one matters. */}
              <polygon points={`${x(i1)},${ya} ${x(i2)},${yb} ${x(i2)},${pb} ${x(i1)},${pa}`}
                fill="var(--accent)" fillOpacity={0.08} />
              <line x1={x(i1)} y1={ya} x2={x(i2)} y2={yb} stroke="var(--accent)" strokeWidth={1.5} />
              <line x1={x(i1)} y1={pa} x2={x(i2)} y2={pb} stroke="var(--accent)" strokeWidth={1.5} />
              <circle cx={x(i1)} cy={ya} r={3} fill="var(--accent)" />
              <circle cx={x(i2)} cy={yb} r={3} fill="var(--accent)" />
              <circle cx={x(i3)} cy={y(d.p3)} r={3} fill="var(--accent)" />
            </g>
          );
        }

        if (d.kind === "fib" || d.kind === "fibext") {
          const from = Math.min(x(i1), x(i2));
          return (
            <g key={d.id}>
              {/* The swing being measured, drawn faintly: without it the
                  levels are just lines with no visible origin. */}
              <line x1={x(i1)} y1={y(d.p1)} x2={x(i2)} y2={y(d.p2)}
                stroke="var(--muted)" strokeWidth={1} strokeDasharray="2 2" />
              {fibLevels(d).map((l) => {
                // 50% and 61.8% are the levels traders actually watch; the
                // rest are context and recede so the pair stays findable.
                const key = l.ratio === 0.5 || l.ratio === 0.618;
                const text = `${(l.ratio * 100).toFixed(1).replace(/[.]0$/, "")}% · ${num(l.price, locale, digits)}`;
                // The line starts AFTER the label. Running it underneath reads
                // as a strikethrough through the number it is labelling.
                const w = text.length * 5.1;
                const gap = from + w + 8;
                return (
                  <g key={l.ratio}>
                    <line x1={Math.min(gap, PAD.left + plotW)} x2={PAD.left + plotW} y1={y(l.price)} y2={y(l.price)}
                      stroke="var(--accent)" strokeWidth={key ? 1.4 : 1} strokeOpacity={key ? 0.9 : 0.45} />
                    {/* A moving average or a candle wick crossing the label
                        reads as a strikethrough through the price. */}
                    <rect x={from} y={y(l.price) - 6} width={w + 4} height={12} rx={2}
                      fill="var(--page)" fillOpacity={0.85} />
                    <text x={from + 2} y={y(l.price) + 3} fontSize={9}
                      fill="var(--accent)" fillOpacity={key ? 1 : 0.75} className="tnum">
                      {text}
                    </text>
                  </g>
                );
              })}
              <circle cx={x(i1)} cy={y(d.p1)} r={3} fill="var(--accent)" />
              <circle cx={x(i2)} cy={y(d.p2)} r={3} fill="var(--accent)" />
            </g>
          );
        }

        if (d.kind !== "trend") return null;
        return (
          <g key={d.id}>
            <line x1={x(i1)} y1={y(trendPriceAt(d, view[i1].t))} x2={x(i2)} y2={y(trendPriceAt(d, view[i2].t))}
              stroke="var(--accent)" strokeWidth={1.5} />
            <circle cx={x(i1)} cy={y(trendPriceAt(d, view[i1].t))} r={3} fill="var(--accent)" />
            <circle cx={x(i2)} cy={y(trendPriceAt(d, view[i2].t))} r={3} fill="var(--accent)" />
          </g>
        );
      })}
      {pending.map((pt, i) => (
        <circle key={`${pt.t}-${i}`} cx={x(nearestIndex(view, pt.t))} cy={y(pt.p)} r={4}
          fill="none" stroke="var(--accent)" strokeWidth={1.5} strokeDasharray="2 2" />
      ))}
    </>
  ), [drawings, pending, view, x, y, plotW, H, locale, digits, PAD]);
  const lastPriceLayer = useMemo(() => (
    <>
      {/* Last-price tag: the standard terminal affordance for "where is it
          right now" without hunting along the axis. */}
      {(() => {
        const lastBar = view[view.length - 1];
        const up = lastBar.c >= (view[view.length - 2]?.c ?? lastBar.o);
        const ly = y(lastBar.c);
        return (
          <g>
            <line x1={PAD.left} x2={PAD.left + plotW} y1={ly} y2={ly}
              stroke={up ? "var(--up)" : "var(--down)"} strokeWidth={1} strokeDasharray="2 3" opacity={0.6} />
            <rect x={PAD.left + plotW + 2} y={ly - 8} width={PAD.right - 4} height={16} rx={2}
              fill={up ? "var(--up)" : "var(--down)"} />
            <text x={PAD.left + plotW + PAD.right / 2} y={ly + 4} fontSize={10} textAnchor="middle"
              fill="#fff" className="tnum">{num(lastBar.c, locale, digits)}</text>
          </g>
        );
      })()}
    </>
  ), [view, y, plotW, locale, digits, PAD]);
  const handleLayer = useMemo(() => (
    <>
      {/* Handles for the selected drawing, drawn last so they sit above every
          drawing they might overlap. A hollow ring, not a filled dot: the
          filled circles already mean "anchor of a channel", and two meanings
          for one shape is how a reader learns to distrust the chart. */}
      {selectedId && drawings.filter((d) => d.id === selectedId).map((d) => (
        <g key={`sel-${d.id}`}>
          {anchorsOf(d).map((a, i) => {
            // An anchor without a time is drawn at the left edge, where the
            // reader can always reach it whatever the window shows.
            const hx = a.axis === "price" ? PAD.left + 10 : x(nearestIndex(view, a.t));
            const hy = a.axis === "time" ? H / 2 : y(a.p);
            if (!Number.isFinite(hx) || !Number.isFinite(hy)) return null;
            return (
              <circle key={i} cx={hx} cy={hy} r={4.5}
                fill="var(--page)" stroke="var(--accent)" strokeWidth={2} />
            );
          })}
        </g>
      ))}
    </>
  ), [selectedId, drawings, view, x, y, H, PAD]);

  return (
    <div className="relative">
      {onCanvas && (
        <PaneCanvas
          width={width} height={H} draw={drawPrice}
          layer={type === "candle" ? "candles" : type}
          columns={type === "candle" ? columnsFor(view.length, maxCols) : undefined}
          windowKey={`${view[0].t}:${view[view.length - 1].t}`}
          compareDashes={compareScaled.map((_, i) => dashFor(i))}
        />
      )}
      <svg
        width="100%" height={H} viewBox={`0 0 ${width} ${H}`} role="img" tabIndex={0}
        aria-label={`${symbol} ${dict.stocks.chartTitle}. ${dict.common.tableView}.`}
        onPointerMove={onMove} onPointerLeave={onLeave} onKeyDown={onKey}
        onPointerDown={onClick} onPointerUp={onUp} onPointerCancel={onUp}
        className={`relative ${mode !== "cursor" ? "cursor-crosshair touch-pan-y" : canPan ? "cursor-grab touch-pan-y active:cursor-grabbing" : "touch-pan-y"}`}
      >
        {gridLayer}

        {seriesLayer}

        {overlayLayer}

        {refLayer}

        {alertLayer}

        {compareLayer}

        {eventLayer}

        {tradeLayer}

        {drawingLayer}

        {lastPriceLayer}

        {/* The horizontal half of the crosshair, at the POINTER rather than at the
            candle: reading a level off a chart means "what price is here", and
            answering only with the close makes the reader estimate the rest. */}
        {cursorY !== null && cursorY > 8 && cursorY < H - 8 && (() => {
          const atCursor = yMin + (1 - (cursorY - 10) / (H - 20)) * (yMax - yMin);
          const lastC = view[view.length - 1]?.c;
          const delta = lastC ? ((atCursor - lastC) / lastC) * 100 : 0;
          return (
            <g>
              <line x1={PAD.left} x2={PAD.left + plotW} y1={cursorY} y2={cursorY}
                stroke="var(--axis)" strokeWidth={1} strokeDasharray="3 3" />
              <rect x={PAD.left + plotW + 2} y={cursorY - 8} width={PAD.right - 4} height={16} rx={2}
                fill="var(--ink-2)" />
              <text x={PAD.left + plotW + PAD.right / 2} y={cursorY + 4} fontSize={10} textAnchor="middle"
                fill="var(--page)" className="tnum">{num(atCursor, locale, digits)}</text>
              {/* Signed, so the distance from the last close reads without colour. */}
              <text x={PAD.left + plotW - 4} y={cursorY - 5} fontSize={10} textAnchor="end"
                fill="var(--muted)" className="tnum">
                {delta >= 0 ? "+" : ""}{num(delta, locale, 2)}%
              </text>
            </g>
          );
        })()}

        {hover !== null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={0} y2={H} stroke="var(--axis)" strokeWidth={1} />
            {/* Price of the hovered bar, pinned to the axis. */}
            <rect x={PAD.left + plotW + 2} y={y(view[hover].c) - 8} width={PAD.right - 4} height={16} rx={2}
              fill="var(--ink)" />
            <text x={PAD.left + plotW + PAD.right / 2} y={y(view[hover].c) + 4} fontSize={10} textAnchor="middle"
              fill="var(--page)" className="tnum">{num(view[hover].c, locale, digits)}</text>
          </g>
        )}

        {handleLayer}
      </svg>

      {/* A three-click tool that says nothing after two clicks reads as broken. */}
      {pending.length > 0 && mode !== "cursor" && (
        <div role="status" className="pointer-events-none absolute right-2 top-1 rounded-lg border border-accent bg-surface px-2 py-0.5 text-[11px] font-medium text-accent">
          {dict.chart.drawNeed.replace("{n}", String(TOOL_POINTS[mode] - pending.length))}
        </div>
      )}

      {hover !== null && (
        <div role="status" className="pointer-events-none absolute top-1 rounded-lg border border-line bg-surface px-2 py-1 text-[11px] shadow-sm"
          style={{ left: Math.min(Math.max(x(hover) - 55, 0), Math.max(0, width - 120)) }}>
          <div className="font-medium">{stamp(view[idx].t, locale, intraday)}</div>
          <div className="tnum text-ink-2">{num(view[idx].c, locale, digits)}</div>
        </div>
      )}
    </div>
  );
}
