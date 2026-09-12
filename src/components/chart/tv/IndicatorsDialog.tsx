"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { INDICATOR_GROUPS, INDICATORS, type IndicatorDef, type IndicatorGroup } from "@/lib/ta/registry";
import { labelFor, parseRef, sameIndicator, shortFor } from "@/lib/ta/params";
import { isEditable } from "@/lib/chart/tf-keys";
import type { Dict } from "@/lib/i18n";
import { IconDelete, IconIndicators } from "./icons";
import { usePopover } from "./usePopover";

export interface PaneToggle {
  id: string;
  label: string;
  on: boolean;
  href: string;
  /** Present when the tier cannot have this pane. */
  lockHref?: string;
}

type Category = "all" | IndicatorGroup | "vn";

/** TradingView's indicators dialog: search, categories, one click to add or remove. */
export function IndicatorsDialog({ dict, active, toggle, limit, unlocked, pricingHref, panes }: {
  dict: Dict; active: string[]; toggle: (d: IndicatorDef) => void; limit: number; unlocked: boolean;
  pricingHref: string; panes: PaneToggle[];
}) {
  const { open, setOpen, wrap, trigger, close } = usePopover();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<Category>("all");
  const show = () => { setQ(""); setOpen(true); };
  const box = useRef<HTMLDialogElement>(null);
  const filter = useRef<HTMLInputElement>(null);
  // Modal, so Tab stays inside and the toolbar it covers is inert; the search box takes focus as it opens.
  useEffect(() => {
    const d = box.current;
    if (!open || !d || d.open) return;
    d.showModal();
    filter.current?.focus();
  }, [open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || isEditable(document.activeElement) || e.metaKey || e.ctrlKey || e.altKey) return;
      e.preventDefault();
      setQ("");
      setOpen(true);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [setOpen]);

  const periodOf = (d: IndicatorDef) => {
    const token = active.find((t) => sameIndicator(t, d.id));
    return token ? (parseRef(token)?.period ?? null) : null;
  };
  const isOn = (d: IndicatorDef) => active.some((t) => sameIndicator(t, d.id));
  const needle = q.trim().toLowerCase();
  const matches = (d: IndicatorDef) => !needle
    || labelFor(d, periodOf(d)).toLowerCase().includes(needle) || shortFor(d, periodOf(d)).toLowerCase().includes(needle);
  const list = INDICATORS.filter((d) => (cat === "all" || d.group === cat) && matches(d));
  const atLimit = active.length >= limit;
  const catBtn = (c: Category, label: string) => (
    <button key={c} type="button" onClick={() => setCat(c)} aria-pressed={cat === c}
      className={`w-full rounded-md px-3 py-1.5 text-left text-[13px] ${cat === c ? "bg-tv-hover font-semibold" : "hover:bg-tv-hover"}`}>
      {label}
    </button>
  );

  return (
    <div ref={wrap} className="relative">
      <button ref={trigger} type="button" onClick={() => (open ? close() : show())} aria-expanded={open} aria-haspopup="dialog"
        className="flex h-8 items-center gap-1 rounded-md px-2 text-[13px] hover:bg-tv-hover">
        <IconIndicators />
        <span className="sr-only sm:not-sr-only">{dict.chart.indicators}</span>
        <span className="tnum text-[11px] text-tv-text-2">{active.length}/{limit}</span>
      </button>
      {open && (
        <dialog ref={box} role="dialog" aria-label={dict.chart.indicators}
          onCancel={(e) => { e.preventDefault(); close(); }}
          onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}
          className="mx-auto mt-24 w-[min(720px,94vw)] rounded-lg border border-tv-border bg-tv-bg p-0 text-tv-text shadow-2xl backdrop:bg-black/30">
          <div className="flex max-h-[70vh] flex-col">
          <div className="flex items-center justify-between border-b border-tv-border px-4 py-3">
            <h2 className="text-[16px] font-semibold">{dict.chart.indicators}</h2>
            <button type="button" onClick={close} aria-label={dict.gate.dismiss} className="grid h-8 w-8 place-items-center rounded-md hover:bg-tv-hover">
              <IconDelete />
            </button>
          </div>
          <div className="border-b border-tv-border px-4 py-2">
            <label htmlFor="ind-filter" className="sr-only">{dict.chart.indFilter}</label>
            <input ref={filter} id="ind-filter" value={q} onChange={(e) => setQ(e.target.value)} placeholder={dict.chart.indFilter}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                const first = list.find((d) => (d.free || unlocked) && (isOn(d) || !atLimit));
                if (first) toggle(first);
              }}
              className="w-full bg-transparent py-1 text-[14px] outline-none" />
          </div>
          <div className="flex min-h-0 flex-1">
            <nav className="w-44 shrink-0 space-y-0.5 border-r border-tv-border p-2">
              {catBtn("all", dict.chart.all)}
              {INDICATOR_GROUPS.map((g) => catBtn(g, dict.chart.indGroup[g]))}
              {panes.length > 0 && catBtn("vn", dict.chart.vnData)}
            </nav>
            <ul className="min-h-0 flex-1 overflow-y-auto p-1">
              {cat === "vn"
                ? panes.map((p) => (
                  <li key={p.id}>
                    <Link href={p.lockHref ?? p.href}
                      className="flex items-center justify-between rounded-md px-3 py-1.5 text-[13px] hover:bg-tv-hover">
                      <span className={p.on ? "font-semibold text-tv-accent-text" : ""}>
                        {p.label}
                        {p.on && <span className="sr-only">, {dict.chart.paneOn}</span>}
                      </span>
                      <span aria-hidden="true" className="text-[11px] text-tv-text-2">{p.lockHref ? "🔒" : p.on ? "✓" : ""}</span>
                    </Link>
                  </li>
                ))
                : list.length === 0
                  ? <li className="px-3 py-2 text-[13px] text-tv-text-2">{dict.chart.indNone}</li>
                  : list.map((def) => {
                    const on = isOn(def);
                    const locked = !def.free && !unlocked;
                    const blocked = !on && atLimit;
                    return (
                      <li key={def.id}>
                        <button type="button" aria-pressed={on} onClick={() => toggle(def)}
                          title={locked ? dict.chart.locked : blocked ? dict.chart.limitReached.replace("{n}", String(limit)) : undefined}
                          className={`flex w-full items-center justify-between rounded-md px-3 py-1.5 text-left text-[13px] hover:bg-tv-hover ${
                            on ? "font-semibold text-tv-accent-text" : locked || blocked ? "text-tv-text-2" : ""}`}>
                          <span>{labelFor(def, periodOf(def))}</span>
                          <span aria-hidden="true" className="tnum text-[11px] text-tv-text-2">
                            {locked ? "🔒" : on ? "✓" : shortFor(def, null)}
                          </span>
                        </button>
                      </li>
                    );
                  })}
            </ul>
          </div>
          {!unlocked && (
            <Link href={pricingHref} className="block border-t border-tv-border px-4 py-2 text-[13px] font-medium text-tv-accent-text hover:underline">
              {dict.chart.unlockAll} →
            </Link>
          )}
          </div>
        </dialog>
      )}
    </div>
  );
}
