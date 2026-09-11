"use client";

import type { Dict } from "@/lib/i18n";
import type { DrawingKind } from "@/lib/chart/drawings";
import { track } from "@/lib/analytics/posthog";
import type { Tier } from "@/lib/types";
import type { RaiseGate } from "./useDrawingStore";

/** Rail icons. The accessible name comes from `aria-label`, not from these. */
const TOOL_GLYPH: Record<"cursor" | DrawingKind, string> = {
  // The channel has no single character that reads as two parallel lines and
  // still fits the button, so it draws its own icon below.
  cursor: "⌖", hline: "─", trend: "╱", fib: "≣", fibext: "⇗", channel: "", trade: "▮",
  ray: "↗", vline: "│", rect: "▭", text: "T", measure: "↔",
};

/**
 * The tool rail. Beside the canvas on a desktop — the trading-terminal
 * convention — and a horizontal scroller ABOVE it on a phone, because twelve
 * 40px targets cannot fit 390px and a non-shrinking rail pushes the whole page
 * into horizontal overflow.
 */
export function DrawingRail({
  dict, canDraw, tier, symbol, raiseGate, mode, setMode, setPending,
  histFlags, stepHistory, selectedId, deleteSelected, hasDrawings, clearDrawings,
}: {
  dict: Dict; canDraw: boolean; tier: Tier; symbol: string; raiseGate: RaiseGate;
  mode: "cursor" | DrawingKind; setMode: (m: "cursor" | DrawingKind) => void;
  setPending: (p: { t: number; p: number }[]) => void;
  histFlags: { undo: boolean; redo: boolean }; stepHistory: (dir: "undo" | "redo") => void;
  selectedId: string | null; deleteSelected: () => void;
  hasDrawings: boolean; clearDrawings: () => void;
}) {
  return (
    <div role="group" aria-label={dict.chart.draw}
      className="flex w-full flex-row gap-1 overflow-x-auto rounded-lg border border-line p-1 lg:w-auto lg:shrink-0 lg:flex-col lg:overflow-visible">
      {(["cursor", "hline", "vline", "trend", "ray", "rect", "fib", "fibext", "channel", "trade", "measure", "text"] as const).map((m) => {
        const locked = !canDraw && m !== "cursor";
        // The original five read their label straight off the tool name;
        // the tools added later are namespaced, so the lookup is explicit
        // rather than a computed key that would silently render blank.
        const label = m === "ray" ? dict.chart.toolRay
          : m === "vline" ? dict.chart.toolVline
          : m === "rect" ? dict.chart.toolRect
          : m === "text" ? dict.chart.toolText
          : m === "measure" ? dict.chart.toolMeasure
          : dict.chart[m];
        return (
          <button
            key={m}
            type="button"
            // Neither `disabled` nor `aria-disabled`. A disabled button
            // cannot be focused, which put the lock's reason and the link
            // out of it behind a pointer; `aria-disabled` would announce
            // "unavailable" about a button that does something, and some
            // voice-control drivers refuse such a target outright. What
            // this actually is, once locked, is an ordinary button that
            // explains the lock — so it is marked as one, and the reason
            // travels in the accessible name.
            onClick={() => {
              if (locked) {
                track("chart_limit_hit", { gate: "drawing", reason: "locked", tool: m, tier, symbol });
                raiseGate({ gate: "drawing", asked: true });
                return;
              }
              setMode(m);
              setPending([]);
            }}
            // Only a usable tool is a toggle. A locked one never becomes
            // the active mode, so claiming "not pressed" would describe a
            // state it cannot enter.
            aria-pressed={locked ? undefined : mode === m}
            aria-label={locked ? `${label} — ${dict.chart.drawLocked}` : label}
            title={locked ? dict.chart.drawLocked : label}
            className={`relative grid h-10 w-10 shrink-0 place-items-center rounded-lg text-[13px] leading-none lg:h-8 lg:w-8 ${
              mode === m ? "bg-page text-ink"
                : locked ? "cursor-not-allowed text-ink-2"
                : "text-ink-2 hover:bg-surface-2 hover:text-ink"
            }`}
          >
            {/* The tool keeps its own glyph when locked and the padlock
                becomes a badge: twelve identical padlocks made the thing
                being sold impossible to tell apart. */}
            <span aria-hidden="true">
              {m === "channel" ? (
                <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth={1.3}>
                  <line x1="1.5" y1="10" x2="8.5" y2="2" />
                  <line x1="6.5" y1="13" x2="13.5" y2="5" />
                </svg>
              ) : TOOL_GLYPH[m]}
            </span>
            {locked && (
              <span aria-hidden="true" className="absolute bottom-0 right-0 text-[10px] leading-none">🔒</span>
            )}
          </button>
        );
      })}
      {/* Undo makes the canvas safe to experiment on, which is the point
          of opening drawings to the free tier at all. Kept beside the
          tools rather than in the top bar: it belongs to this canvas. */}
      {(histFlags.undo || histFlags.redo) && (
        <div className="mt-1 flex flex-col gap-1 border-t border-line pt-1">
          <button type="button" onClick={() => stepHistory("undo")} disabled={!histFlags.undo}
            aria-label={dict.chart.undo} title={dict.chart.undo}
            className="grid h-8 w-8 place-items-center rounded-lg text-[13px] leading-none text-ink-2 hover:bg-surface-2 hover:text-ink disabled:opacity-40">
            <span aria-hidden="true">↶</span>
          </button>
          <button type="button" onClick={() => stepHistory("redo")} disabled={!histFlags.redo}
            aria-label={dict.chart.redo} title={dict.chart.redo}
            className="grid h-8 w-8 place-items-center rounded-lg text-[13px] leading-none text-ink-2 hover:bg-surface-2 hover:text-ink disabled:opacity-40">
            <span aria-hidden="true">↷</span>
          </button>
        </div>
      )}
      {selectedId && (
        <button type="button" onClick={deleteSelected}
          aria-label={dict.chart.deleteSelected} title={dict.chart.deleteSelected}
          className="grid h-8 w-8 place-items-center rounded-lg text-[13px] leading-none text-ink-2 hover:bg-surface-2 hover:text-down">
          <span aria-hidden="true">⌫</span>
        </button>
      )}
      {hasDrawings && (
        <button type="button" onClick={clearDrawings}
          aria-label={dict.chart.clearDrawings} title={dict.chart.clearDrawings}
          className="grid h-8 w-8 place-items-center rounded-lg text-[13px] text-ink-2 hover:bg-surface-2 hover:text-down">
          <span aria-hidden="true">🗑</span>
        </button>
      )}
    </div>
  );
}
