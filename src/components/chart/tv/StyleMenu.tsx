"use client";

import type { ReactNode } from "react";
import { focusMenu, menuKeys, usePopover } from "./usePopover";
import { CHART_TYPES, type ChartTypeId } from "@/lib/chart/chart-types";
import type { Dict } from "@/lib/i18n";
import {
  IconArea, IconBars, IconBaseline, IconCandles, IconColumns, IconHeikin, IconHighLow, IconHollow, IconLine, IconStep,
} from "./icons";

export const STYLE_ICON: Record<ChartTypeId, () => ReactNode> = {
  bars: IconBars, candle: IconCandles, hollow: IconHollow, heikin: IconHeikin, line: IconLine, step: IconStep,
  area: IconArea, baseline: IconBaseline, columns: IconColumns, highlow: IconHighLow,
};

export function styleLabel(dict: Dict, t: ChartTypeId): string {
  const c = dict.chart;
  return { bars: c.styleBars, candle: c.candle, hollow: c.styleHollow, heikin: c.styleHeikin, line: c.line,
    step: c.styleStep, area: c.area, baseline: c.styleBaseline, columns: c.styleColumns, highlow: c.styleHighLow }[t];
}

export function StyleMenu({ dict, type, setType }: { dict: Dict; type: ChartTypeId; setType: (t: ChartTypeId) => void }) {
  const { open, toggle, wrap, trigger, close, at } = usePopover("below-start", 224);
  const Current = STYLE_ICON[type];
  return (
    <div ref={wrap} className="relative">
      <button ref={trigger} type="button" onClick={toggle} aria-expanded={open} aria-haspopup="menu"
        aria-label={`${dict.chart.type}: ${styleLabel(dict, type)}`} title={dict.chart.type}
        className="grid h-8 w-8 place-items-center rounded-md hover:bg-tv-hover">
        <Current />
      </button>
      {open && (
        <div ref={focusMenu} role="menu" aria-label={dict.chart.type} onKeyDown={menuKeys} style={at}
          className="z-40 max-h-[70vh] w-56 overflow-y-auto rounded-md border border-tv-border bg-tv-bg py-1 shadow-xl">
          {CHART_TYPES.map((t) => {
            const Icon = STYLE_ICON[t];
            return (
              <button key={t} type="button" role="menuitemradio" tabIndex={-1} aria-checked={t === type}
                onClick={() => { setType(t); close(); }}
                className={`flex w-full items-center gap-2 px-3 py-1 text-left text-[13px] hover:bg-tv-hover ${
                  t === type ? "text-tv-accent-text" : "text-tv-text"}`}>
                <Icon />
                {styleLabel(dict, t)}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
