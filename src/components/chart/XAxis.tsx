"use client";

import { useMemo } from "react";
import { barTime, dateOnly } from "@/lib/format";
import type { Locale } from "@/lib/types";
import { stamp, useChartSeries } from "./chartShared";
import { PlotLayer } from "./panLayers";
import { useHoverIndex } from "./crosshair";

export function XAxis({
  lead, bleedPx, plotW, PAD, fromEnd, width, x, xStep, locale, intraday,
}: {
  lead: number; bleedPx: number; plotW: number;
  PAD: { left: number; right: number };
  /** How many bars `drawView[0]` sits before the newest bar. */
  fromEnd: number;
  width: number; x: (i: number) => number; xStep: number; locale: Locale; intraday: boolean;
}) {
  const { drawView } = useChartSeries();
  // An intraday axis that printed only the clock would repeat "09:00" at every
  // tick once the window spans more than a day, which tells the reader nothing.
  // Ticks that open a new trading day carry the date; ticks inside a day carry
  // the clock — the way a terminal axis reads. Ticks are counted from the
  // newest bar, not from the window's first, so a pan does not pick different
  // bars for them on every render.
  const ticks = useMemo(() => {
    const out: { j: number; label: string }[] = [];
    let lastDay = "";
    for (let j = 0; j < drawView.length; j++) {
      const back = fromEnd - j;
      if (back === 0 || back % xStep !== 0) continue;
      const day = dateOnly(drawView[j].t, locale).slice(0, 5);
      out.push({
        j,
        label: !intraday || day !== lastDay ? day : barTime(drawView[j].t, locale),
      });
      lastDay = day;
    }
    return out;
  }, [drawView, fromEnd, xStep, locale, intraday]);

  return (
    <div className="relative" style={{ height: 20 }}>
      <PlotLayer left={PAD.left} width={plotW} height={20}>
        <svg height={20} aria-hidden="true" data-axis-ticks="" className="absolute top-0 block"
          style={{ left: -bleedPx, width: plotW + 2 * bleedPx }}
          viewBox={`${PAD.left - bleedPx} 0 ${plotW + 2 * bleedPx} 20`}>
          {ticks.map((t) => (
            <text key={drawView[t.j].t} x={x(t.j - lead)} y={13} fontSize={10} textAnchor="middle" fill="var(--muted)">
              {t.label}
            </text>
          ))}
        </svg>
      </PlotLayer>
      <svg width="100%" height={20} viewBox={`0 0 ${width} 20`} aria-hidden="true" className="relative block">
        <AxisHoverTag x={x} locale={locale} intraday={intraday} />
      </svg>
    </div>
  );
}

/** The hovered bar's date, pinned to the axis. */
function AxisHoverTag({ x, locale, intraday }: { x: (i: number) => number; locale: Locale; intraday: boolean }) {
  const { view } = useChartSeries();
  const hover = useHoverIndex(view.length);
  if (hover === null) return null;
  return (
    <g>
      <rect x={Math.max(0, x(hover) - (intraday ? 34 : 26))} y={1} width={intraday ? 68 : 52} height={16} rx={2} fill="var(--ink)" />
      <text x={Math.max(intraday ? 34 : 26, x(hover))} y={12.5} fontSize={9.5} textAnchor="middle" fill="var(--page)" className="tnum">
        {stamp(view[hover].t, locale, intraday)}
      </text>
    </g>
  );
}
