"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";
import { openSymbolSearch } from "@/components/SymbolSearch";
import { writeStored } from "@/lib/browser-store";
import { can } from "@/lib/auth/entitlement";
import { DEFAULT_APPEARANCE } from "@/lib/chart/appearance";
import type { Dict } from "@/lib/i18n";
import { CompareMenu, type CompareInfo } from "./CompareMenu";
import { IndicatorsDialog, type PaneToggle } from "./IndicatorsDialog";
import { LayoutMenu, type LayoutChoice } from "./LayoutMenu";
import { StyleMenu } from "./StyleMenu";
import { ShareButtons } from "./ShareButtons";
import { HelpSheet } from "./HelpSheet";
import { SettingsDialog } from "./SettingsDialog";
import {
  IconAlert, IconCamera, IconExitFullscreen, IconFullscreen, IconGear, IconRedo, IconReplay, IconSearch, IconUndo,
} from "./icons";
import { useWorkspace } from "./store";

const RAIL_TAB = "rail:tab";
const icon = "grid h-8 w-8 place-items-center rounded-md hover:bg-tv-hover disabled:opacity-40";
const text = "flex h-8 items-center gap-1 rounded-md px-2 text-[13px] hover:bg-tv-hover";
const Sep = () => <span aria-hidden="true" className="mx-1 h-6 w-px shrink-0 bg-tv-border" />;

/** TradingView's header toolbar, acting on the workspace's primary chart. */
export function TopBar({ dict, symbol, interval, compare, panes, layouts, layout, layoutLockHref, pricingHref, full, toggleFull }: {
  dict: Dict; symbol: string; interval: ReactNode; compare: CompareInfo; panes: PaneToggle[];
  layouts: LayoutChoice[]; layout: number; layoutLockHref: string; pricingHref: string;
  full: boolean; toggleFull: () => void;
}) {
  const ws = useWorkspace();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const gear = useRef<HTMLButtonElement>(null);
  const closeSettings = useCallback(() => { setSettingsOpen(false); gear.current?.focus(); }, []);
  return (
    <div className="relative flex h-[38px] shrink-0 items-center gap-0.5 overflow-x-auto border-b border-tv-border px-1.5 text-tv-text">
      <button type="button" onClick={() => openSymbolSearch()} aria-label={dict.chart.changeSymbol}
        className="flex h-8 min-w-24 items-center justify-between gap-2 rounded-full bg-tv-hover px-3 text-[13px] font-semibold">
        {symbol}
        <IconSearch />
      </button>
      <CompareMenu dict={dict} info={compare} />
      <Sep />
      {interval}
      <Sep />
      {ws && <StyleMenu dict={dict} type={ws.type} setType={ws.setType} />}
      {ws && (
        <IndicatorsDialog dict={dict} active={ws.active} toggle={ws.toggle} limit={ws.limit} unlocked={ws.unlocked}
          pricingHref={pricingHref} panes={panes} />
      )}
      <Sep />
      <button type="button" onClick={() => writeStored(RAIL_TAB, "alerts")} className={text}>
        <IconAlert />
        <span className="sr-only md:not-sr-only">{dict.chart.tabAlerts}</span>
      </button>
      {ws && (
        <button type="button" aria-pressed={ws.replayOn} onClick={ws.toggleReplay}
          className={`${text} ${ws.replayOn ? "text-tv-accent-text" : ""}`}>
          <IconReplay />
          <span className="sr-only md:not-sr-only">{dict.chart.replay}</span>
        </button>
      )}
      <Sep />
      <button type="button" onClick={() => ws?.stepHistory("undo")} disabled={!ws?.histFlags.undo}
        aria-label={dict.chart.undo} title={dict.chart.undo} className={icon}>
        <IconUndo />
      </button>
      <button type="button" onClick={() => ws?.stepHistory("redo")} disabled={!ws?.histFlags.redo}
        aria-label={dict.chart.redo} title={dict.chart.redo} className={icon}>
        <IconRedo />
      </button>
      <span className="min-w-2 flex-1" />
      <LayoutMenu dict={dict} choices={layouts} current={layout} lockHref={layoutLockHref} />
      <button type="button" onClick={() => writeStored(RAIL_TAB, "layouts")} className={text}>
        {dict.chart.saveLayout}
      </button>
      <Sep />
      <button type="button" onClick={() => openSymbolSearch()} aria-label={dict.chart.changeSymbol} title={dict.chart.changeSymbol} className={icon}>
        <IconSearch />
      </button>
      {ws && <HelpSheet dict={dict} canDraw={ws.canDraw} />}
      {ws && (
        <button ref={gear} type="button" onClick={() => setSettingsOpen(true)} aria-haspopup="dialog"
          aria-label={dict.chart.settings} title={dict.chart.settings} className={icon}>
          <IconGear />
        </button>
      )}
      <button type="button" aria-pressed={full} onClick={toggleFull}
        title={full ? dict.chart.exitFullscreen : dict.chart.fullscreen} className={icon}>
        {full ? <IconExitFullscreen /> : <IconFullscreen />}
        <span aria-hidden="true" className="sr-only">{full ? "⤢" : "⛶"}</span>
        <span className="sr-only">{full ? dict.chart.exitFullscreen : dict.chart.fullscreen}</span>
      </button>
      {ws && (
        <ShareButtons dict={dict} symbol={ws.symbol} tf={ws.tf} credit={!can(ws.tier, "sync:docs")} shoot={ws.shoot}
          trigger={<IconCamera />} />
      )}
      {settingsOpen && ws && (
        <SettingsDialog
          labels={{
            title: dict.chart.settings, close: dict.gate.dismiss,
            tabs: { symbol: dict.chart.settingsSymbol, canvas: dict.chart.settingsCanvas },
            up: dict.chart.upColor, down: dict.chart.downColor, themeColour: dict.chart.themeColour,
            grid: dict.chart.gridLines, magnet: dict.chart.magnet, volume: dict.chart.showVolume, reset: dict.chart.resetDefaults,
            colorNames: dict.chart.colorNames,
          }}
          appearance={ws.appearance} themeUp={ws.themeUp} themeDown={ws.themeDown}
          onChange={ws.setAppearance} onReset={() => ws.setAppearance(DEFAULT_APPEARANCE)} onClose={closeSettings} />
      )}
    </div>
  );
}
