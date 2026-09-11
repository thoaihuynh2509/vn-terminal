"use client";

import { useCallback, useRef, useState } from "react";
import { PATHS, type Dict } from "@/lib/i18n";
import type { IndicatorDef } from "@/lib/ta/registry";
import { IndicatorMenu } from "./IndicatorMenu";
import { ShareMenu } from "./ShareMenu";
import { useDismiss } from "@/lib/ui/use-dismiss";
import type { RangePreset } from "@/lib/chart/ranges";
import { SCALES, type ScaleId } from "@/lib/chart/scale";
import { track } from "@/lib/analytics/posthog";
import type { Locale } from "@/lib/types";
import type { ChartType } from "./chartShared";

export function Toolbar({
  dict, locale, unlocked, limit, type, setType, scale, setScale, pickPreset, active, toggle, asTable, setAsTable,
  full, toggleFull, canDraw, presets, activePreset, barCount, getPanes, symbol, tf, exportSite,
}: {
  dict: Dict; locale: Locale; unlocked: boolean; limit: number;
  type: ChartType; setType: (t: ChartType) => void;
  scale: ScaleId; setScale: (s: ScaleId) => void;
  pickPreset: (id: RangePreset, count: number) => void;
  presets: { id: RangePreset; count: number }[];
  activePreset: RangePreset | null;
  barCount: number;
  getPanes: () => SVGSVGElement[];
  symbol: string;
  tf: string;
  /** `null` means a clean image; `undefined` means stamp with this origin. */
  exportSite?: string | null;
  active: string[]; toggle: (d: IndicatorDef) => void;
  asTable: boolean; setAsTable: (v: boolean) => void;
  full: boolean; toggleFull: () => void; canDraw: boolean;
}) {
  const seg = "px-2.5 py-1 text-[12px] font-medium transition-colors";
  const btn = "shrink-0 rounded-lg border border-line px-2.5 py-1 text-[12px] font-medium text-ink-2 hover:text-ink";
  const pricingHref = `/${locale}/${PATHS.pricing[locale]}?plan=plus`;

  return (
    // One row that scrolls on a phone; wraps only once there is room to.
    <div className="relative -mx-4 flex items-center gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:overflow-visible md:px-0 md:pb-0">
      <div role="group" aria-label={dict.chart.type} className="flex shrink-0 rounded-lg border border-line">
        {(["candle", "line", "area"] as ChartType[]).map((t) => (
          <button key={t} type="button" onClick={() => { setType(t); track("chart_type_changed", { type: t }); }} aria-pressed={type === t}
            className={`${seg} first:rounded-l last:rounded-r ${type === t ? "bg-page text-ink" : "text-ink-2 hover:text-ink"}`}>
            {dict.chart[t]}
          </button>
        ))}
      </div>

      <IndicatorMenu dict={dict} unlocked={unlocked} limit={limit} active={active} toggle={toggle} pricingHref={pricingHref} />

      {/* Zoom is the wheel and +/−; the one button left is the way back out. */}
      <div role="group" aria-label={dict.chart.range} className="flex shrink-0 rounded-lg border border-line">
        {presets.map((p) => (
          <button key={p.id} type="button" onClick={() => pickPreset(p.id, p.count)}
            aria-pressed={activePreset === p.id}
            className={`${seg} first:rounded-l last:rounded-r ${
              activePreset === p.id ? "bg-page text-ink" : "text-ink-2 hover:text-ink"
            }`}>
            {p.id === "ALL" ? dict.chart.all : p.id}
          </button>
        ))}
      </div>

      {/* The price axis. Free for every tier: reading a chart on the right axis
          is a basic, and over years a linear axis makes doubling your money
          look smaller than a ten-percent move. */}
      <div role="group" aria-label={dict.chart.scale} className="flex shrink-0 rounded-lg border border-line">
        {SCALES.map((sc) => (
          <button key={sc} type="button" onClick={() => setScale(sc)} aria-pressed={scale === sc}
            title={dict.chart.scaleHint[sc]}
            className={`${seg} first:rounded-l last:rounded-r ${
              scale === sc ? "bg-page text-ink" : "text-ink-2 hover:text-ink"
            }`}>
            {dict.chart.scaleLabel[sc]}
          </button>
        ))}
      </div>

      {/* The zoom level, in the unit the chart is actually drawn in. Without it
          a wheel-scroll changes the picture with nothing to say by how much. */}
      <span className="tnum shrink-0 text-[11px] text-muted">{barCount} {dict.chart.bars}</span>

      <button type="button" onClick={() => setAsTable(!asTable)} aria-pressed={asTable} className={btn}>
        {asTable ? dict.common.chartView : dict.common.tableView}
      </button>

      <span className="ml-auto flex shrink-0 items-center gap-2">
        <ShareMenu
          dict={dict} getPanes={getPanes} symbol={symbol} tf={tf}
          site={exportSite === null ? null : (typeof window === "undefined" ? null : window.location.origin)}
        />
        <HelpSheet dict={dict} canDraw={canDraw} />
        <button type="button" onClick={toggleFull} aria-pressed={full}
          title={full ? dict.chart.exitFullscreen : dict.chart.fullscreen}
          className="rounded-lg border border-line px-2 py-1 text-[12px] font-medium text-ink-2 hover:text-ink">
          <span aria-hidden="true">{full ? "⤢" : "⛶"}</span>
          <span className="sr-only">{full ? dict.chart.exitFullscreen : dict.chart.fullscreen}</span>
        </button>
      </span>
    </div>
  );
}

/** The `?` button: every shortcut in one sheet, instead of hint lines under the chart. */
function HelpSheet({ dict, canDraw }: { dict: Dict; canDraw: boolean }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(wrap, open, close);
  const rows = (["pan", "zoom", "tf", "ind", "sym", ...(canDraw ? ["draw" as const] : []), "esc"] as const)
    .map((k) => dict.chart.keys[k]);
  return (
    <div ref={wrap} className="relative">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="dialog"
        aria-label={dict.chart.help} title={dict.chart.help}
        className="rounded-lg border border-line px-2.5 py-1 text-[12px] font-semibold text-ink-2 hover:text-ink">
        ?
      </button>
      {open && (
        <div role="dialog" aria-label={dict.chart.help}
          className="absolute right-0 top-full z-30 mt-1 w-72 rounded-lg border border-line bg-surface p-3 text-[12px] shadow-lg">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted">{dict.chart.help}</p>
          <ul className="space-y-1.5 text-ink-2">
            {rows.map((r) => <li key={r}>{r}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}
