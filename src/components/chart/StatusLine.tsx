"use client";

import { num, volume as fmtVol } from "@/lib/format";
import type { Dict } from "@/lib/i18n";
import { COLOR_VAR, type IndicatorDef, type Plot } from "@/lib/ta/registry";
import { labelFor, shortFor } from "@/lib/ta/params";
import type { Locale } from "@/lib/types";
import { stamp, useChartSeries } from "./chartShared";
import { PeriodChip } from "./PeriodChip";
import { useHoverIndex } from "./crosshair";

/**
 * Status line: symbol + OHLC + indicator values, the way a terminal reports
 * the bar under the cursor.
 */
export function StatusLine({
  symbol, groups, locale, digits, intraday, dict, setPeriod, toggle,
}: {
  symbol: string;
  groups: { def: IndicatorDef; period: number | null; plots: Plot[] }[];
  locale: Locale; digits: number; intraday: boolean; dict: Dict;
  setPeriod: (def: IndicatorDef, period: number) => void; toggle: (def: IndicatorDef) => void;
}) {
  // The bar under the crosshair, else the last one.
  const { view } = useChartSeries();
  const idx = useHoverIndex(view.length) ?? view.length - 1;
  const activeBar = view[idx];
  const activeChange = activeBar.c - (idx > 0 ? view[idx - 1].c : activeBar.o);
  return (
    <dl className="tnum mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-line bg-page px-2.5 py-1.5 text-[12px]">
      <div className="flex gap-1.5"><dt className="sr-only">{dict.chart.symbol}</dt><dd className="font-bold tracking-tight">{symbol}</dd></div>
      <div className="flex gap-1.5"><dt className="sr-only">{dict.common.updated}</dt><dd title={dict.common.updated}>{stamp(activeBar.t, locale, intraday)}</dd></div>
      <div className="flex gap-1.5"><dt className="text-muted">O</dt><dd>{num(activeBar.o, locale, digits)}</dd></div>
      <div className="flex gap-1.5"><dt className="text-muted">H</dt><dd>{num(activeBar.h, locale, digits)}</dd></div>
      <div className="flex gap-1.5"><dt className="text-muted">L</dt><dd>{num(activeBar.l, locale, digits)}</dd></div>
      <div className="flex gap-1.5">
        <dt className="text-muted">C</dt>
        <dd className={activeChange >= 0 ? "text-up" : "text-down"}>
          <span aria-hidden="true">{activeChange >= 0 ? "▲" : "▼"}</span> {num(activeBar.c, locale, digits)}
        </dd>
      </div>
      {activeBar.v > 0 && (
        <div className="flex gap-1.5"><dt className="text-muted">V</dt><dd>{fmtVol(activeBar.v, locale)}</dd></div>
      )}
      {/* One chip per indicator, with its value under the cursor and the
          way to remove it — the legend and the off switch are one thing. */}
      {groups.map(({ def, period, plots }) => {
        const mine = def.pane === "price" ? plots : [];
        const color = COLOR_VAR[plots[0]?.color ?? "muted"];
        return (
          <div key={def.id} className="flex items-center gap-1.5 rounded-lg border border-line bg-surface pl-1.5">
            {/* The chip names the indicator AND is where its period is set —
                the legend is already where a reader looks to see what is on. */}
            <dt style={{ color }}>
              {def.param
                ? <PeriodChip def={def} period={period} dict={dict} onChange={setPeriod} color={color} />
                : shortFor(def, period)}
            </dt>
            <dd>
              {mine.length
                ? mine.map((p) => (p.series[idx] === null ? "—" : num(p.series[idx]!, locale, digits))).join(" / ")
                : null}
            </dd>
            <button type="button" onClick={() => toggle(def)} aria-label={`${dict.chart.remove} ${labelFor(def, period)}`}
              className="px-1.5 py-0.5 text-[11px] leading-none text-muted hover:text-down">
              <span aria-hidden="true">×</span>
            </button>
          </div>
        );
      })}
    </dl>
  );
}
