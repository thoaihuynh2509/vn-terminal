"use client";

import { useEffect, useId, useRef, useState } from "react";
import { STYLE_COLORS, type StyleColor } from "@/lib/chart/drawing-style";
import type { Appearance } from "@/lib/chart/appearance";

export interface SettingsLabels {
  title: string;
  close: string;
  tabs: { symbol: string; canvas: string };
  up: string;
  down: string;
  themeColour: string;
  grid: string;
  magnet: string;
  volume: string;
  reset: string;
  colorNames: Record<StyleColor, string>;
}

type Tab = "symbol" | "canvas";
const TABS: Tab[] = ["symbol", "canvas"];

/** TradingView's chart settings, in the two tabs that matter here: the candles and the canvas. */
export function SettingsDialog({ labels, appearance, themeUp, themeDown, onChange, onReset, onClose }: {
  labels: SettingsLabels;
  appearance: Appearance;
  themeUp: string;
  themeDown: string;
  onChange: (next: Appearance) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>("symbol");
  const box = useRef<HTMLDialogElement>(null);
  const id = useId();
  // Opened as a modal so Tab stays inside and the page behind is inert, which a positioned div cannot promise.
  useEffect(() => {
    const d = box.current;
    if (d && !d.open) d.showModal();
    return () => d?.close();
  }, []);
  const dismiss = () => {
    box.current?.close();
    onClose();
  };
  const set = (patch: Partial<Appearance>) => onChange({ ...appearance, ...patch });
  const swatches = (value: string, theme: string, pick: (c: string) => void, label: string) => (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-1">
      <button type="button" onClick={() => pick("")} aria-pressed={value === ""} title={labels.themeColour}
        className={`h-7 rounded-md border px-2 text-[11px] ${value === "" ? "border-tv-accent" : "border-tv-border"}`}
        style={{ color: theme }}>
        {labels.themeColour}
      </button>
      {STYLE_COLORS.map((c) => (
        <button key={c} type="button" onClick={() => pick(c)} aria-pressed={value === c} aria-label={labels.colorNames[c]}
          title={labels.colorNames[c]}
          className={`h-7 w-7 rounded-md border ${value === c ? "border-tv-accent" : "border-transparent"}`}
          style={{ background: c }} />
      ))}
    </div>
  );
  const toggle = (on: boolean, label: string, flip: () => void) => (
    <label className="flex cursor-pointer items-center justify-between gap-4 py-2 text-[13px]">
      {label}
      <input type="checkbox" checked={on} onChange={flip} className="h-4 w-4 accent-tv-accent" />
    </label>
  );
  const moveTab = (from: Tab) => {
    const next = TABS[(TABS.indexOf(from) + 1) % TABS.length];
    setTab(next);
    document.getElementById(`${id}-tab-${next}`)?.focus();
  };
  return (
    <dialog ref={box} aria-labelledby={`${id}-title`}
      onCancel={(e) => { e.preventDefault(); dismiss(); }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) dismiss(); }}
      className="m-auto w-[min(560px,94vw)] rounded-lg border border-tv-border bg-tv-bg p-0 text-tv-text shadow-2xl backdrop:bg-black/40">
      <div className="flex max-h-[80vh] flex-col">
        <div className="flex items-center justify-between border-b border-tv-border px-4 py-3">
          <h2 id={`${id}-title`} className="text-[16px] font-semibold">{labels.title}</h2>
          <button type="button" onClick={dismiss} aria-label={labels.close} className="grid h-8 w-8 place-items-center rounded-md hover:bg-tv-hover">×</button>
        </div>
        <div className="flex min-h-0 flex-1">
          <div role="tablist" aria-label={labels.title} aria-orientation="vertical" className="w-36 shrink-0 border-r border-tv-border p-2">
            {TABS.map((t) => (
              <button key={t} id={`${id}-tab-${t}`} type="button" role="tab" aria-selected={tab === t} aria-controls={`${id}-panel`}
                tabIndex={tab === t ? 0 : -1} onClick={() => setTab(t)}
                onKeyDown={(e) => {
                  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
                  e.preventDefault();
                  moveTab(t);
                }}
                className={`w-full rounded-md px-3 py-1.5 text-left text-[13px] ${tab === t ? "bg-tv-hover font-semibold" : "hover:bg-tv-hover"}`}>
                {labels.tabs[t]}
              </button>
            ))}
          </div>
          <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-tab-${tab}`} className="min-h-0 flex-1 overflow-y-auto p-4">
            {tab === "symbol" ? (
              <div className="space-y-4">
                <div><p className="mb-1.5 text-[12px] text-tv-text-2">{labels.up}</p>{swatches(appearance.upColor, themeUp, (c) => set({ upColor: c }), labels.up)}</div>
                <div><p className="mb-1.5 text-[12px] text-tv-text-2">{labels.down}</p>{swatches(appearance.downColor, themeDown, (c) => set({ downColor: c }), labels.down)}</div>
                {toggle(appearance.volume, labels.volume, () => set({ volume: !appearance.volume }))}
              </div>
            ) : (
              <div className="divide-y divide-tv-border">
                {toggle(appearance.grid, labels.grid, () => set({ grid: !appearance.grid }))}
                {toggle(appearance.magnet, labels.magnet, () => set({ magnet: !appearance.magnet }))}
              </div>
            )}
          </div>
        </div>
        <div className="flex justify-end border-t border-tv-border px-4 py-2.5">
          <button type="button" onClick={onReset} className="rounded-md border border-tv-border px-3 py-1.5 text-[13px] hover:bg-tv-hover">
            {labels.reset}
          </button>
        </div>
      </div>
    </dialog>
  );
}
