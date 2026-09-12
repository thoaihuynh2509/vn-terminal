"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useStored, writeStored } from "@/lib/browser-store";
import { DEFAULT_SETTINGS, MAX_WS_RATIO, MIN_WS_RATIO, SETTINGS_KEY, clampWsRatio, parseSettings, serializeSettings } from "@/lib/chart/settings";
import type { Dict } from "@/lib/i18n";
import { BottomBar, type RangeLink } from "./BottomBar";
import type { CompareInfo } from "./CompareMenu";
import type { PaneToggle } from "./IndicatorsDialog";
import type { LayoutChoice } from "./LayoutMenu";
import { ToolRail } from "./ToolRail";
import { TopBar } from "./TopBar";
import { WorkspaceContext, createWorkspaceStore } from "./store";

/** Share of the window one arrow press on the divider moves. */
const RATIO_STEP = 0.03;

/** The TradingView chart screen: header toolbar, drawing tools, charts, bottom toolbar and the side panel. */
export function Workspace({ dict, symbol, interval, compare, panes, layouts, layout, layoutLockHref, pricingHref, rangeLink, panel, children }: {
  dict: Dict; symbol: string; interval: ReactNode; compare: CompareInfo; panes: PaneToggle[];
  layouts: LayoutChoice[]; layout: number; layoutLockHref: string; pricingHref: string;
  rangeLink: RangeLink; panel: ReactNode; children: ReactNode;
}) {
  const [store] = useState(createWorkspaceStore);
  const root = useRef<HTMLDivElement>(null);
  const [full, setFull] = useState(false);
  const [vh, setVh] = useState(900);
  const [top, setTop] = useState(112);
  const stored = useStored(SETTINGS_KEY);
  const [ratioChoice, setRatioChoice] = useState<number | null>(null);
  const ratio = ratioChoice ?? parseSettings(stored)?.wsRatio ?? null;
  const height = ratio === null ? Math.max(480, vh - top) : Math.max(360, Math.round(vh * clampWsRatio(ratio)));
  // A held arrow key repeats faster than React renders, so presses compose through this rather than state.
  const ratioRef = useRef<number | null>(null);
  useEffect(() => { ratioRef.current = height / vh; }, [height, vh]);

  useEffect(() => {
    const measure = () => {
      setVh(window.innerHeight);
      const r = root.current?.getBoundingClientRect();
      if (r && !full) setTop(Math.round(r.top + window.scrollY));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [full]);
  useEffect(() => {
    if (!full) return;
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") setFull(false); };
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [full]);

  const persistRatio = (r: number) => {
    const current = parseSettings(stored) ?? DEFAULT_SETTINGS;
    writeStored(SETTINGS_KEY, serializeSettings({ ...current, wsRatio: r }));
  };
  const setRatio = (r: number) => {
    const next = clampWsRatio(r);
    ratioRef.current = next;
    setRatioChoice(next);
    persistRatio(next);
  };
  const onDividerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const y0 = e.clientY, r0 = ratioRef.current ?? 0.8;
    const move = (ev: PointerEvent) => {
      const r = clampWsRatio(r0 + (ev.clientY - y0) / window.innerHeight);
      ratioRef.current = r;
      setRatioChoice(r);
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      if (ratioRef.current !== null) persistRatio(ratioRef.current);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };

  return (
    <WorkspaceContext.Provider value={store}>
      <div ref={root}
        className={`tv-workspace flex flex-col bg-tv-bg text-tv-text ${full ? "fixed inset-0 z-50" : "border-b border-tv-border"}`}
        style={full ? undefined : { height }}>
        <TopBar dict={dict} symbol={symbol} interval={interval} compare={compare} panes={panes} layouts={layouts}
          layout={layout} layoutLockHref={layoutLockHref} pricingHref={pricingHref} full={full} toggleFull={() => setFull((v) => !v)} />
        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          <ToolRail />
          <div className="relative min-h-0 min-w-0 flex-1">{children}</div>
          <aside className={`contents ${full ? "" : "lg:block lg:w-[340px] lg:shrink-0 lg:overflow-y-auto lg:border-l lg:border-tv-border"}`}>
            {!full && panel}
          </aside>
        </div>
        <BottomBar dict={dict} rangeLink={rangeLink} />
      </div>
      {!full && (
        <div role="separator" aria-orientation="horizontal" aria-label={dict.chart.resizePane} tabIndex={0}
          aria-valuemin={Math.round(MIN_WS_RATIO * 100)} aria-valuemax={Math.round(MAX_WS_RATIO * 100)}
          aria-valuenow={Math.round((height / vh) * 100)}
          onKeyDown={(e) => {
            if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
            e.preventDefault();
            setRatio((ratioRef.current ?? 0.8) + (e.key === "ArrowDown" ? RATIO_STEP : -RATIO_STEP));
          }}
          onPointerDown={onDividerDown}
          className="flex h-2 cursor-row-resize touch-none items-center justify-center bg-tv-bg hover:bg-tv-hover">
          <span aria-hidden="true" className="h-0.5 w-10 rounded-full bg-tv-border" />
        </div>
      )}
    </WorkspaceContext.Provider>
  );
}
