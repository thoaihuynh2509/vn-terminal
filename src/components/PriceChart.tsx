"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Bar, Locale } from "@/lib/types";
import { dateOnly, num, volume as fmtVolume } from "@/lib/format";
import type { Dict } from "@/lib/i18n";
import { Delta } from "./Delta";

type Mode = "candles" | "line";

/**
 * Candlestick / line chart, hand-built in SVG.
 *
 * Two rules from the viz spec drive the geometry here:
 *  - direction is never colour-alone, so up candles are HOLLOW (surface fill,
 *    coloured stroke) and down candles are FILLED. Colourblind readers get the
 *    direction from the body fill even when the hues collapse.
 *  - the container height includes the x-axis band, so axis labels are never
 *    clipped into a nested scrollbar.
 * Volume sits in its own sub-panel with its own baseline — a stacked small
 * multiple, NOT a second y-axis on the price plot.
 */
export function PriceChart({
  bars,
  locale,
  dict,
  digits = 2,
  height = 320,
  showVolume = true,
}: {
  bars: Bar[];
  locale: Locale;
  dict: Dict;
  digits?: number;
  height?: number;
  showVolume?: boolean;
}) {
  const [mode, setMode] = useState<Mode>("candles");
  const [asTable, setAsTable] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(880);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(320, e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Layout: axis bands are part of the box, never overflow out of it.
  const PAD = { top: 12, right: 56, bottom: 24, left: 8 };
  const volH = showVolume ? 48 : 0;
  const gap = showVolume ? 10 : 0;
  const plotH = height - PAD.top - PAD.bottom - volH - gap;
  const plotW = width - PAD.left - PAD.right;

  const scale = useMemo(() => {
    if (!bars.length) return null;
    const lows = bars.map((b) => b.l);
    const highs = bars.map((b) => b.h);
    const min = Math.min(...lows);
    const max = Math.max(...highs);
    const padY = (max - min) * 0.06 || max * 0.02 || 1;
    const yMin = min - padY;
    const yMax = max + padY;
    const maxVol = Math.max(...bars.map((b) => b.v), 1);
    const band = plotW / bars.length;
    return {
      yMin, yMax, maxVol, band,
      x: (i: number) => PAD.left + band * (i + 0.5),
      y: (v: number) => PAD.top + plotH - ((v - yMin) / (yMax - yMin)) * plotH,
      vy: (v: number) => volH - (v / maxVol) * volH,
    };
  }, [bars, plotW, plotH, volH, PAD.left, PAD.top]);

  const onMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (!scale || !bars.length) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left - PAD.left;
      const i = Math.round(x / scale.band - 0.5);
      setHover(Math.max(0, Math.min(bars.length - 1, i)));
    },
    [scale, bars.length, PAD.left],
  );

  // Keyboard parity: the crosshair must be reachable without a pointer.
  const onKey = useCallback(
    (e: React.KeyboardEvent<SVGSVGElement>) => {
      if (!bars.length) return;
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        setHover((h) => {
          const base = h ?? bars.length - 1;
          return Math.max(0, Math.min(bars.length - 1, base + (e.key === "ArrowRight" ? 1 : -1)));
        });
      } else if (e.key === "Escape") setHover(null);
    },
    [bars.length],
  );

  if (!bars.length) {
    return <p className="py-12 text-center text-[13px] text-muted">{dict.common.noData}</p>;
  }

  const s = scale!;
  const ticks = 4;
  const yTicks = Array.from({ length: ticks + 1 }, (_, i) => s.yMin + ((s.yMax - s.yMin) * i) / ticks);
  // Roughly six date labels, snapped to real bars so a label never lies.
  const xStep = Math.max(1, Math.floor(bars.length / 6));
  const activeIdx = hover ?? bars.length - 1;
  const active = bars[activeIdx];
  // Measured against the PREVIOUS CLOSE, matching the change shown in the page
  // header and everywhere else in the app. Candle bodies still use close-vs-open
  // (that is what a candle means) — but the read-out must not contradict the header.
  const activePrevClose = activeIdx > 0 ? bars[activeIdx - 1].c : active.o;
  const activeChange = active.c - activePrevClose;

  const linePath = bars
    .map((b, i) => `${i === 0 ? "M" : "L"}${s.x(i).toFixed(1)},${s.y(b.c).toFixed(1)}`)
    .join(" ");

  return (
    <div>
      {/* Controls sit in one row above the plot, per the interaction spec. */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div role="group" aria-label={dict.stocks.chartTitle} className="flex rounded border border-line">
          {(["candles", "line"] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              aria-pressed={mode === m}
              className={`px-2.5 py-1 text-[12px] font-medium first:rounded-l last:rounded-r ${
                mode === m ? "bg-surface-2 text-ink" : "text-ink-2 hover:text-ink"
              }`}
            >
              {m === "candles" ? dict.stocks.candles : dict.stocks.line}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setAsTable((v) => !v)}
          aria-pressed={asTable}
          className="rounded border border-line px-2.5 py-1 text-[12px] font-medium text-ink-2 hover:text-ink"
        >
          {asTable ? dict.common.chartView : dict.common.tableView}
        </button>

        {/* Live read-out of the hovered/focused bar. */}
        <dl className="tnum ml-auto flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px]">
          <div className="flex gap-1"><dt className="text-muted">{dict.common.open}</dt><dd>{num(active.o, locale, digits)}</dd></div>
          <div className="flex gap-1"><dt className="text-muted">{dict.common.high}</dt><dd>{num(active.h, locale, digits)}</dd></div>
          <div className="flex gap-1"><dt className="text-muted">{dict.common.low}</dt><dd>{num(active.l, locale, digits)}</dd></div>
          <div className="flex gap-1">
            <dt className="text-muted">C</dt>
            <dd className="flex items-center gap-1">
              <span className="font-medium">{num(active.c, locale, digits)}</span>
              <Delta change={activeChange} locale={locale} digits={digits} showAbsolute />
            </dd>
          </div>
        </dl>
      </div>

      {asTable ? (
        <div className="max-h-[320px] overflow-auto rounded border border-line">
          <table className="tnum w-full text-[12px]">
            <caption className="sr-only">{dict.stocks.chartTitle}</caption>
            <thead className="sticky top-0 bg-surface-2 text-left text-muted">
              <tr>
                <th scope="col" className="px-2 py-1.5 font-medium">{dict.common.updated}</th>
                <th scope="col" className="px-2 py-1.5 text-right font-medium">{dict.common.open}</th>
                <th scope="col" className="px-2 py-1.5 text-right font-medium">{dict.common.high}</th>
                <th scope="col" className="px-2 py-1.5 text-right font-medium">{dict.common.low}</th>
                <th scope="col" className="px-2 py-1.5 text-right font-medium">{dict.common.price}</th>
                <th scope="col" className="px-2 py-1.5 text-right font-medium">{dict.common.volume}</th>
              </tr>
            </thead>
            <tbody>
              {[...bars].reverse().map((b) => (
                <tr key={b.t} className="border-t border-line">
                  <td className="px-2 py-1">{dateOnly(b.t, locale)}</td>
                  <td className="px-2 py-1 text-right">{num(b.o, locale, digits)}</td>
                  <td className="px-2 py-1 text-right">{num(b.h, locale, digits)}</td>
                  <td className="px-2 py-1 text-right">{num(b.l, locale, digits)}</td>
                  <td className={`px-2 py-1 text-right ${b.c >= b.o ? "text-up" : "text-down"}`}>
                    <span aria-hidden="true">{b.c >= b.o ? "▲" : "▼"}</span> {num(b.c, locale, digits)}
                  </td>
                  <td className="px-2 py-1 text-right text-ink-2">{b.v ? fmtVolume(b.v, locale) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div ref={wrapRef} className="relative w-full">
          <svg
            width="100%"
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            role="img"
            tabIndex={0}
            aria-label={`${dict.stocks.chartTitle}. ${dict.common.tableView}.`}
            onPointerMove={onMove}
            onPointerLeave={() => setHover(null)}
            onKeyDown={onKey}
            className="touch-pan-y"
          >
            {/* Recessive hairline grid — solid, one shade off the surface. */}
            {yTicks.map((v) => (
              <g key={v}>
                <line x1={PAD.left} x2={PAD.left + plotW} y1={s.y(v)} y2={s.y(v)} stroke="var(--grid)" strokeWidth={1} />
                <text x={PAD.left + plotW + 6} y={s.y(v) + 3.5} fontSize={10} fill="var(--muted)" className="tnum">
                  {num(v, locale, digits)}
                </text>
              </g>
            ))}

            {mode === "line" ? (
              <path d={linePath} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" />
            ) : (
              bars.map((b, i) => {
                const up = b.c >= b.o;
                const color = up ? "var(--up)" : "var(--down)";
                const bw = Math.max(1.5, Math.min(s.band * 0.62, 14));
                const yTop = s.y(Math.max(b.o, b.c));
                const bodyH = Math.max(1, Math.abs(s.y(b.o) - s.y(b.c)));
                return (
                  <g key={b.t}>
                    <line x1={s.x(i)} x2={s.x(i)} y1={s.y(b.h)} y2={s.y(b.l)} stroke={color} strokeWidth={1} />
                    <rect
                      x={s.x(i) - bw / 2}
                      y={yTop}
                      width={bw}
                      height={bodyH}
                      /* hollow = up, filled = down: direction without colour */
                      fill={up ? "var(--surface)" : color}
                      stroke={color}
                      strokeWidth={1}
                    />
                  </g>
                );
              })
            )}

            {showVolume &&
              bars.map((b, i) => {
                const bw = Math.max(1.5, Math.min(s.band * 0.62, 14));
                const top = PAD.top + plotH + gap + s.vy(b.v);
                const h = volH - s.vy(b.v);
                return (
                  <rect
                    key={`v${b.t}`}
                    x={s.x(i) - bw / 2}
                    y={top}
                    width={bw}
                    height={Math.max(0.5, h)}
                    fill={b.c >= b.o ? "var(--up)" : "var(--down)"}
                    opacity={0.32}
                  />
                );
              })}

            {/* x-axis band, inside the box */}
            {bars.map((b, i) =>
              i % xStep === 0 && i < bars.length - 1 ? (
                <text key={`x${b.t}`} x={s.x(i)} y={height - 8} fontSize={10} textAnchor="middle" fill="var(--muted)">
                  {dateOnly(b.t, locale).slice(0, 5)}
                </text>
              ) : null,
            )}

            {hover !== null && (
              <line
                x1={s.x(hover)} x2={s.x(hover)} y1={PAD.top} y2={PAD.top + plotH + gap + volH}
                stroke="var(--axis)" strokeWidth={1}
              />
            )}
          </svg>

          {hover !== null && (
            <div
              role="status"
              className="pointer-events-none absolute top-2 rounded border border-line bg-surface px-2 py-1.5 text-[11px] shadow-sm"
              style={{
                left: Math.min(Math.max(s.x(hover) - 60, 0), Math.max(0, width - 130)),
              }}
            >
              <div className="font-medium">{dateOnly(bars[hover].t, locale)}</div>
              <div className="tnum mt-0.5 text-ink-2">
                {dict.common.price} <span className="text-ink">{num(bars[hover].c, locale, digits)}</span>
              </div>
              {bars[hover].v > 0 && (
                <div className="tnum text-ink-2">
                  {dict.common.volume} <span className="text-ink">{fmtVolume(bars[hover].v, locale)}</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
