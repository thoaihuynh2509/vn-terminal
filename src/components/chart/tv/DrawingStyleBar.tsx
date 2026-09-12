"use client";

import { useCallback, useRef, useState } from "react";
import { STYLE_COLORS, STYLE_DASHES, STYLE_WIDTHS, type DrawingStyle, type StyleColor } from "@/lib/chart/drawing-style";
import { useDismiss } from "@/lib/ui/use-dismiss";

export interface StyleBarLabels {
  toolbar: string;
  color: string;
  width: string;
  dash: Record<NonNullable<DrawingStyle["dash"]>, string>;
  remove: string;
  colorNames: Record<StyleColor, string>;
}

type Menu = "color" | "width" | "dash";

const btn = "grid h-8 min-w-8 place-items-center rounded-md px-1 hover:bg-tv-hover";

/** TradingView's floating toolbar for the selected drawing: colour, thickness, line style, delete. */
export function DrawingStyleBar({ labels, style, fallback, onChange, onDelete }: {
  labels: StyleBarLabels;
  style: DrawingStyle | undefined;
  /** The tool's default colour, shown when the drawing has none of its own. */
  fallback: string;
  onChange: (next: DrawingStyle) => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState<Menu | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const triggers = useRef<Partial<Record<Menu, HTMLButtonElement | null>>>({});
  const close = useCallback(() => {
    const inside = !!wrap.current?.contains(document.activeElement);
    setOpen(null);
    if (open && inside) triggers.current[open]?.focus();
  }, [open]);
  useDismiss(wrap, open !== null, close);
  const cur = { color: style?.color ?? fallback, width: style?.width ?? 2, dash: style?.dash ?? "solid" };
  const set = (patch: DrawingStyle) => { onChange({ ...style, ...patch }); close(); };
  const pop = "absolute left-0 top-full z-40 mt-1 rounded-md border border-tv-border bg-tv-bg p-1 shadow-xl";
  return (
    <div ref={wrap} role="toolbar" aria-label={labels.toolbar}
      className="absolute left-1/2 top-2 z-30 flex -translate-x-1/2 items-center gap-0.5 rounded-lg border border-tv-border bg-tv-bg p-1 text-tv-text shadow-xl">
      <div className="relative">
        <button ref={(el) => { triggers.current.color = el; }} type="button" onClick={() => setOpen(open === "color" ? null : "color")} aria-expanded={open === "color"}
          aria-label={labels.color} title={labels.color} className={btn}>
          <span aria-hidden="true" className="h-4 w-4 rounded-sm border border-tv-border" style={{ background: cur.color }} />
        </button>
        {open === "color" && (
          <div role="group" aria-label={labels.color} className={`${pop} grid w-36 grid-cols-4 gap-1`}>
            {STYLE_COLORS.map((c) => (
              <button key={c} type="button" onClick={() => set({ color: c })} aria-pressed={cur.color === c} aria-label={labels.colorNames[c]} title={labels.colorNames[c]}
                className={`h-7 w-7 rounded-md border ${cur.color === c ? "border-tv-accent" : "border-transparent"}`}
                style={{ background: c }} />
            ))}
          </div>
        )}
      </div>
      <div className="relative">
        <button ref={(el) => { triggers.current.width = el; }} type="button" onClick={() => setOpen(open === "width" ? null : "width")} aria-expanded={open === "width"}
          aria-label={labels.width} title={labels.width} className={`${btn} text-[12px]`}>
          <span aria-hidden="true" className="block w-5 rounded-full bg-current" style={{ height: cur.width }} />
          <span className="ml-1 tnum">{cur.width}px</span>
        </button>
        {open === "width" && (
          <div role="group" aria-label={labels.width} className={`${pop} w-24`}>
            {STYLE_WIDTHS.map((w) => (
              <button key={w} type="button" onClick={() => set({ width: w })} aria-pressed={cur.width === w}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-[12px] hover:bg-tv-hover">
                <span aria-hidden="true" className="block w-8 rounded-full bg-current" style={{ height: w }} />
                <span className="tnum">{w}px</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="relative">
        <button ref={(el) => { triggers.current.dash = el; }} type="button" onClick={() => setOpen(open === "dash" ? null : "dash")} aria-expanded={open === "dash"}
          aria-label={labels.dash[cur.dash]} title={labels.dash[cur.dash]} className={btn}>
          <svg width="22" height="10" aria-hidden="true"><line x1="1" y1="5" x2="21" y2="5" stroke="currentColor" strokeWidth="2"
            strokeDasharray={cur.dash === "dashed" ? "5 3" : cur.dash === "dotted" ? "1.5 3" : undefined} /></svg>
        </button>
        {open === "dash" && (
          <div role="group" aria-label={labels.dash[cur.dash]} className={`${pop} w-40`}>
            {STYLE_DASHES.map((d) => (
              <button key={d} type="button" onClick={() => set({ dash: d })} aria-pressed={cur.dash === d}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-[12px] hover:bg-tv-hover">
                <svg width="28" height="10" aria-hidden="true"><line x1="1" y1="5" x2="27" y2="5" stroke="currentColor" strokeWidth="2"
                  strokeDasharray={d === "dashed" ? "5 3" : d === "dotted" ? "1.5 3" : undefined} /></svg>
                {labels.dash[d]}
              </button>
            ))}
          </div>
        )}
      </div>
      <span aria-hidden="true" className="mx-0.5 h-5 w-px bg-tv-border" />
      <button type="button" onClick={onDelete} aria-label={labels.remove} title={labels.remove} className={btn}>
        <svg width="20" height="20" viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
          <path d="M8 9h12M11 9V7h6v2M9.5 9l.8 12h7.4l.8-12" />
        </svg>
      </button>
    </div>
  );
}
