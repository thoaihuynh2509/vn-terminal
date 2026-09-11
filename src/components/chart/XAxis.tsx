"use client";

import { useMemo } from "react";
import { barTime, dateOnly } from "@/lib/format";
import type { Bar, Locale } from "@/lib/types";
import { stamp } from "./chartShared";

export function XAxis({ view, width, x, xStep, locale, hover, intraday }: { view: Bar[]; width: number; x: (i: number) => number; xStep: number; locale: Locale; hover: number | null; intraday: boolean }) {
  // An intraday axis that printed only the clock would repeat "09:00" at every
  // tick once the window spans more than a day, which tells the reader nothing.
  // Ticks that open a new trading day carry the date; ticks inside a day carry
  // the clock — the way a terminal axis reads.
  const ticks = useMemo(() => {
    const out: { i: number; label: string }[] = [];
    let lastDay = "";
    for (let i = 0; i < view.length - 1; i++) {
      if (i % xStep !== 0) continue;
      const day = dateOnly(view[i].t, locale).slice(0, 5);
      out.push({
        i,
        label: !intraday || day !== lastDay ? day : barTime(view[i].t, locale),
      });
      lastDay = day;
    }
    return out;
  }, [view, xStep, locale, intraday]);

  return (
    <svg width="100%" height={20} viewBox={`0 0 ${width} 20`} aria-hidden="true" className="block">
      {hover !== null && (
        <g>
          <rect x={Math.max(0, x(hover) - (intraday ? 34 : 26))} y={1} width={intraday ? 68 : 52} height={16} rx={2} fill="var(--ink)" />
          <text x={Math.max(intraday ? 34 : 26, x(hover))} y={12.5} fontSize={9.5} textAnchor="middle" fill="var(--page)" className="tnum">
            {stamp(view[hover].t, locale, intraday)}
          </text>
        </g>
      )}
      {ticks.map((t) => (
        <text key={view[t.i].t} x={Math.max(x(t.i), 18)} y={13} fontSize={10} textAnchor="middle" fill="var(--muted)">
          {t.label}
        </text>
      ))}
    </svg>
  );
}
