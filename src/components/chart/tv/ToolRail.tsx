"use client";

import type { ReactNode } from "react";
import { track } from "@/lib/analytics/posthog";
import {
  IconChannel, IconCross, IconDelete, IconFib, IconFibExt, IconHLine, IconMeasure, IconRay, IconRect, IconText,
  IconTrade, IconTrash, IconTrend, IconVLine,
} from "./icons";
import { useWorkspace, type ToolMode } from "./store";

const TOOLS: [ToolMode, () => ReactNode][] = [
  ["cursor", IconCross], ["trend", IconTrend], ["ray", IconRay], ["hline", IconHLine], ["vline", IconVLine],
  ["channel", IconChannel], ["fib", IconFib], ["fibext", IconFibExt], ["rect", IconRect], ["measure", IconMeasure],
  ["trade", IconTrade], ["text", IconText],
];

const btn = "grid h-10 w-10 shrink-0 place-items-center rounded-md text-tv-text hover:bg-tv-hover lg:h-9 lg:w-9";

/** TradingView's left toolbar: the drawing tools of the primary chart. */
export function ToolRail() {
  const ws = useWorkspace();
  if (!ws) return <div className="w-[52px] shrink-0 border-r border-tv-border" />;
  const { dict, canDraw, mode, setMode, setPending, tier, symbol, raiseGate } = ws;
  const labelOf = (m: ToolMode) => m === "ray" ? dict.chart.toolRay
    : m === "vline" ? dict.chart.toolVline
    : m === "rect" ? dict.chart.toolRect
    : m === "text" ? dict.chart.toolText
    : m === "measure" ? dict.chart.toolMeasure
    : dict.chart[m];
  return (
    <div role="group" aria-label={dict.chart.draw}
      className="relative flex shrink-0 flex-row gap-0.5 overflow-x-auto border-b border-tv-border p-1 lg:w-[52px] lg:flex-col lg:items-center lg:overflow-visible lg:border-b-0 lg:border-r lg:py-1.5">
      {TOOLS.map(([m, Icon]) => {
        const locked = !canDraw && m !== "cursor";
        const label = labelOf(m);
        return (
          <button key={m} type="button"
            onClick={() => {
              if (locked) {
                track("chart_limit_hit", { gate: "drawing", reason: "locked", tool: m, tier, symbol });
                raiseGate({ gate: "drawing", asked: true });
                return;
              }
              setMode(m);
              setPending([]);
            }}
            aria-pressed={locked ? undefined : mode === m}
            aria-label={locked ? `${label} — ${dict.chart.drawLocked}` : label}
            title={locked ? dict.chart.drawLocked : label}
            className={`${btn} relative ${mode === m ? "text-tv-accent-text" : ""} ${locked ? "opacity-50" : ""}`}>
            <Icon />
            {locked && <span aria-hidden="true" className="absolute bottom-0 right-0 text-[9px] leading-none">🔒</span>}
          </button>
        );
      })}
      <span aria-hidden="true" className="mx-1 w-px self-stretch bg-tv-border lg:mx-0 lg:my-1 lg:h-px lg:w-7" />
      {ws.selectedId && (
        <button type="button" onClick={ws.deleteSelected} aria-label={dict.chart.deleteSelected} title={dict.chart.deleteSelected} className={btn}>
          <IconDelete />
        </button>
      )}
      {ws.hasDrawings && (
        <button type="button" onClick={ws.clearDrawings} aria-label={dict.chart.clearDrawings} title={dict.chart.clearDrawings} className={btn}>
          <IconTrash />
        </button>
      )}
    </div>
  );
}
