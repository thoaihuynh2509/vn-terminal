"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { INDICATOR_GROUPS, INDICATORS, type IndicatorDef } from "@/lib/ta/registry";
import { labelFor, parseRef, sameIndicator, shortFor } from "@/lib/ta/params";
import { isEditable } from "@/lib/chart/tf-keys";
import { useDismiss } from "@/lib/ui/use-dismiss";
import type { Dict } from "@/lib/i18n";

/**
 * The indicator picker: one button, one grouped menu, a filter box.
 *
 * `/` opens it from anywhere on the page (the terminal convention), typing
 * narrows the list, Enter toggles the first match.
 */
export function IndicatorMenu({
  dict, unlocked, limit, active, toggle, pricingHref,
}: {
  dict: Dict; unlocked: boolean; limit: number;
  active: string[]; toggle: (d: IndicatorDef) => void;
  pricingHref: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const wrap = useRef<HTMLDivElement>(null);
  // The filter is cleared on close, not in an effect watching `open`: the menu
  // unmounts anyway, so the only job is to make sure the next open starts blank.
  const close = useCallback(() => { setOpen(false); setQ(""); }, []);
  useDismiss(wrap, open, close);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || isEditable(document.activeElement) || e.metaKey || e.ctrlKey || e.altKey) return;
      e.preventDefault();
      setOpen(true);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const atLimit = active.length >= limit;
  const needle = q.trim().toLowerCase();
  /** The period a token carries for this indicator, or null when it is off. */
  const periodOf = (d: IndicatorDef) => {
    const token = active.find((t) => sameIndicator(t, d.id));
    return token ? (parseRef(token)?.period ?? null) : null;
  };
  const isOn = (d: IndicatorDef) => active.some((t) => sameIndicator(t, d.id));
  // Typing "21" should find the RSI a reader tuned to 21, so the tuned label is
  // searched too, not just the catalogue name.
  const matches = (d: IndicatorDef) =>
    !needle
    || labelFor(d, periodOf(d)).toLowerCase().includes(needle)
    || shortFor(d, periodOf(d)).toLowerCase().includes(needle);
  const visible = INDICATORS.filter(matches);

  return (
    <div ref={wrap} className="relative">
      <button type="button" onClick={() => (open ? close() : setOpen(true))} aria-expanded={open} aria-haspopup="menu"
        className="flex items-center gap-1.5 rounded border border-line px-2.5 py-1 text-[12px] font-medium text-ink-2 hover:text-ink">
        {dict.chart.indicators}
        <span className="tnum text-[11px] text-muted">{active.length}/{limit}</span>
        <span aria-hidden="true" className="text-[10px]">▾</span>
      </button>

      {open && (
        <div role="menu" aria-label={dict.chart.indicators}
          className="absolute left-0 top-full z-30 mt-1 max-h-[60vh] w-64 overflow-y-auto rounded border border-line bg-surface shadow-lg">
          <div className="sticky top-0 border-b border-line bg-surface p-2">
            <label htmlFor="ind-filter" className="sr-only">{dict.chart.indFilter}</label>
            <input
              id="ind-filter" value={q} autoFocus onChange={(e) => setQ(e.target.value)}
              placeholder={dict.chart.indFilter}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                const first = visible.find((d) => (d.free || unlocked) && (isOn(d) || !atLimit));
                if (first) toggle(first);
              }}
              className="w-full rounded border border-line bg-page px-2 py-1 text-[12px]"
            />
          </div>
          {visible.length === 0 && <p className="px-3 py-2 text-[12px] text-muted">{dict.chart.indNone}</p>}
          {INDICATOR_GROUPS.map((g) => {
            const defs = visible.filter((d) => d.group === g);
            if (!defs.length) return null;
            return (
              <div key={g} className="border-b border-line last:border-b-0">
                <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted">
                  {dict.chart.indGroup[g]}
                </p>
                <ul>
                  {defs.map((def) => {
                    const on = isOn(def);
                    const locked = !def.free && !unlocked;
                    const blocked = !on && atLimit;
                    return (
                      <li key={def.id}>
                        <button type="button" role="menuitemcheckbox" aria-checked={on}
                          onClick={() => toggle(def)} disabled={locked || blocked}
                          title={locked ? dict.chart.locked : blocked ? dict.chart.limitReached.replace("{n}", String(limit)) : undefined}
                          className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-[12px] ${
                            on ? "bg-surface-2 font-semibold text-ink"
                              : locked || blocked ? "cursor-not-allowed text-muted opacity-60"
                              : "text-ink-2 hover:bg-surface-2 hover:text-ink"
                          }`}>
                          {/* An active indicator shows the period it is ACTUALLY
                              running at, not the catalogue default. */}
                          <span>{labelFor(def, periodOf(def))}</span>
                          <span aria-hidden="true" className="tnum text-[11px] text-muted">
                            {locked ? "🔒" : on ? "✓" : shortFor(def, null)}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
          {!unlocked && (
            <Link href={pricingHref} className="block border-t border-line px-3 py-2 text-[12px] font-medium text-accent hover:underline">
              {dict.chart.unlockAll} →
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
