"use client";

import { useCallback, useRef, useState } from "react";
import type { Dict } from "@/lib/i18n";
import type { IndicatorDef } from "@/lib/ta/registry";
import { clampPeriod, effectivePeriod, labelFor, shortFor } from "@/lib/ta/params";
import { useDismiss } from "@/lib/ui/use-dismiss";

/**
 * The period control, hung off the legend chip.
 *
 * A popover rather than a dialog: retuning an indicator is an adjustment made
 * while looking at the chart, and a modal would hide the thing being tuned.
 * The chip itself stays the label, so nothing is added to the toolbar.
 *
 * Committed on blur/Enter rather than per keystroke — typing "1" on the way to
 * "150" must not recompute the chart at period 1 and jump the scale.
 */
export function PeriodChip({
  def, period, dict, onChange, color,
}: {
  def: IndicatorDef; period: number | null; dict: Dict;
  onChange: (def: IndicatorDef, period: number) => void; color: string;
}) {
  const current = effectivePeriod(def, period);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(String(current));
  const wrap = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(wrap, open, close);

  const commit = (raw: string) => {
    const n = Number(raw);
    // A blank or nonsense entry restores what was there — never silently 0.
    onChange(def, Number.isFinite(n) && n > 0 ? n : current);
    setDraft(String(Number.isFinite(n) && n > 0 ? clampPeriod(def, n) : current));
  };
  const nudge = (by: number) => {
    const next = clampPeriod(def, current + by);
    setDraft(String(next));
    onChange(def, next);
  };

  return (
    <div ref={wrap} className="relative inline-block">
      <button
        type="button"
        onClick={() => { setDraft(String(current)); setOpen((o) => !o); }}
        aria-expanded={open}
        aria-label={`${dict.chart.indPeriod} ${labelFor(def, period)}`}
        style={{ color }}
        className="rounded-lg px-0.5 hover:underline"
      >
        {shortFor(def, period)}
      </button>
      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-44 rounded-lg border border-line bg-surface p-2 shadow-lg">
          <label htmlFor={`per-${def.id}`} className="block text-[11px] text-muted">
            {dict.chart.indPeriod}
          </label>
          <div className="mt-1 flex items-center gap-1">
            <button type="button" onClick={() => nudge(-1)} aria-label={dict.chart.indPeriodDown}
              className="rounded-lg border border-line px-1.5 py-0.5 text-[12px] text-ink-2 hover:text-ink">−</button>
            <input
              id={`per-${def.id}`} type="number" inputMode="numeric"
              min={def.param!.min} max={def.param!.max} value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={(e) => commit(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); commit((e.target as HTMLInputElement).value); close(); }
                if (e.key === "Escape") { e.preventDefault(); close(); }
              }}
              className="tnum w-full rounded-lg border border-line bg-page px-2 py-0.5 text-center text-[12px]"
            />
            <button type="button" onClick={() => nudge(1)} aria-label={dict.chart.indPeriodUp}
              className="rounded-lg border border-line px-1.5 py-0.5 text-[12px] text-ink-2 hover:text-ink">+</button>
          </div>
          <p className="mt-1 text-[10px] text-muted">
            {def.param!.min}–{def.param!.max}
          </p>
        </div>
      )}
    </div>
  );
}
