"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { can } from "@/lib/auth/entitlement";
import { byGroup, GROUPS, isCustom, parseCustom, timeframe, TIMEFRAMES, type TfGroup, type Timeframe } from "@/lib/chart/timeframes";
import { isBufferKey, isEditable, resolveTyped, stepTimeframe } from "@/lib/chart/tf-keys";
import type { Dict } from "@/lib/i18n";
import type { Tier } from "@/lib/types";

/** The intervals worth one click. Everything else lives behind the dropdown. */
const QUICK = ["5m", "1h", "1D", "1W", "1M"];

const GROUP_LABEL: Record<TfGroup, keyof Dict["chart"]> = {
  minutes: "tfMinutes",
  hours: "tfHours",
  days: "tfDays",
};

/**
 * Interval selector.
 *
 * The choice lives in the URL, not in client state, for the same reason the
 * layout does: a chart someone sends a colleague should open on the interval
 * they were looking at. That also means the server can fetch the right bars on
 * the first render instead of drawing daily candles and then swapping them.
 */
export function TimeframePicker({
  current, base, extraQuery, dict, tier, pricingHref,
}: {
  current: string;
  /** Path without a query string. */
  base: string;
  /** Already-encoded params to preserve (layout, companion symbols). */
  extraQuery: string;
  dict: Dict;
  tier: Tier;
  /** Where the upsell points when intraday is locked. */
  pricingHref: string;
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [custom, setCustom] = useState("");
  const [customBad, setCustomBad] = useState(false);
  const [refused, setRefused] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const intraday = can(tier, "chart:intraday");
  const active = timeframe(current);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    const onClick = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  const href = useCallback(
    (id: string) => `${base}?tf=${encodeURIComponent(id)}${extraQuery}`,
    [base, extraQuery],
  );

  const go = useCallback((id: string | null) => {
    if (!id) return;
    // Refusing silently reads as a broken key, so a locked interval says so.
    if (timeframe(id).intraday && !intraday) { setRefused(true); return; }
    router.push(href(id));
  }, [href, intraday, router]);

  /**
   * Interval shortcuts.
   *
   * Typed input accumulates into a short-lived buffer ("1", then "5", then "m")
   * because intervals are two and three characters long; it clears on its own so
   * a half-typed interval never silently combines with the next keystroke.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // A keystroke aimed at a field belongs to the field — the alert price
      // input is on this page.
      if (isEditable(document.activeElement) || e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === "Escape") { setTyped(""); setRefused(false); return; }
      if (e.key === "," ) { e.preventDefault(); setOpen((v) => !v); return; }
      if (e.key === "[" || e.key === "]") {
        e.preventDefault();
        go(stepTimeframe(active.id, e.key === "]" ? 1 : -1, intraday));
        return;
      }
      if (!isBufferKey(e.key)) return;

      const next = (typed + e.key).slice(-4);
      const hit = resolveTyped(next);
      if (hit) { e.preventDefault(); setTyped(""); go(hit); return; }
      setTyped(next);
      setRefused(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [active.id, go, intraday, typed]);

  // The buffer is a guess at an unfinished interval; it must not outlive the
  // reader's attention or the next keystroke joins something they forgot about.
  useEffect(() => {
    if (!typed && !refused) return;
    const id = setTimeout(() => { setTyped(""); setRefused(false); }, 1400);
    return () => clearTimeout(id);
  }, [typed, refused]);

  const label = (t: Timeframe) => `${t.n} ${dict.chart.tfUnit[t.unit]}`;
  const locked = (t: Timeframe) => t.intraday && !intraday;
  const seg = "px-2.5 py-1 text-[12px] font-medium transition-colors";

  // The quick row always contains the current interval. Without this, choosing
  // "3 months" from the menu leaves every visible pill unselected and the reader
  // cannot see what the chart is showing.
  const builtIn = TIMEFRAMES.filter((t) => QUICK.includes(t.id) || t.id === active.id);
  const pills = isCustom(active.id) ? [...builtIn, active] : builtIn;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted">
        {dict.chart.timeframe}
      </span>

      {/* Pills and the full list share one border so they read as one control
          rather than two that happen to sit side by side. */}
      <div ref={wrap} className="relative">
        <div role="group" aria-label={dict.chart.timeframe} className="flex rounded border border-line">
          {pills.map((t) => {
            const on = t.id === active.id;
            return locked(t) ? (
              <span key={t.id} title={dict.chart.tfLocked} aria-disabled="true"
                className={`${seg} tnum cursor-not-allowed text-muted opacity-55 first:rounded-l`}>
                🔒 {t.id}
              </span>
            ) : (
              <Link key={t.id} href={href(t.id)} aria-current={on ? "page" : undefined}
                className={`${seg} tnum first:rounded-l ${
                  on ? "bg-surface-2 text-ink" : "text-ink-2 hover:text-ink"
                }`}>
                {t.id}
              </Link>
            );
          })}
          <button type="button" onClick={() => setOpen(!open)}
            aria-expanded={open} aria-haspopup="menu"
            className="rounded-r border-l border-line px-2 py-1 text-[10px] text-ink-2 hover:bg-surface-2 hover:text-ink">
            <span aria-hidden="true">▾</span>
            <span className="sr-only">{dict.chart.timeframe}</span>
          </button>
        </div>

        {open && (
          <div role="menu" aria-label={dict.chart.timeframe}
            className="absolute left-0 top-full z-30 mt-1 max-h-[60vh] w-52 overflow-y-auto rounded border border-line bg-surface shadow-lg">
            {GROUPS.map((g) => (
              <div key={g} className="border-b border-line last:border-b-0">
                <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted">
                  {dict.chart[GROUP_LABEL[g]] as string}
                </p>
                <ul>
                  {byGroup(g).map((t) => {
                    const on = t.id === active.id;
                    if (locked(t)) {
                      return (
                        <li key={t.id}>
                          <span title={dict.chart.tfLocked} aria-disabled="true"
                            className="flex cursor-not-allowed items-center justify-between px-3 py-1.5 text-[12px] text-muted opacity-60">
                            <span>{label(t)}</span>
                            <span aria-hidden="true">🔒</span>
                          </span>
                        </li>
                      );
                    }
                    return (
                      <li key={t.id}>
                        <Link href={href(t.id)} role="menuitem" onClick={() => setOpen(false)}
                          aria-current={on ? "page" : undefined}
                          className={`flex items-center justify-between px-3 py-1.5 text-[12px] hover:bg-surface-2 ${
                            on ? "bg-surface-2 font-semibold text-ink" : "text-ink-2"
                          }`}>
                          <span>{label(t)}</span>
                          <span className="tnum text-[11px] text-muted">{t.id}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}

            <form
              className="border-t border-line p-2"
              onSubmit={(e) => {
                e.preventDefault();
                const id = custom.trim();
                if (!parseCustom(id)) { setCustomBad(true); return; }
                setCustomBad(false);
                setCustom("");
                setOpen(false);
                go(id);
              }}
            >
              <label htmlFor="tf-custom" className="block pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted">
                {dict.chart.tfCustom}
              </label>
              <div className="flex gap-1">
                <input
                  id="tf-custom"
                  value={custom}
                  onChange={(e) => { setCustom(e.target.value); setCustomBad(false); }}
                  placeholder="7m"
                  aria-invalid={customBad || undefined}
                  aria-describedby="tf-custom-hint"
                  className="tnum w-full min-w-0 rounded border border-line bg-page px-2 py-1 text-[12px]"
                />
                <button type="submit"
                  className="shrink-0 rounded border border-line px-2 py-1 text-[12px] font-medium text-ink-2 hover:bg-surface-2 hover:text-ink">
                  {dict.chart.tfCustomAdd}
                </button>
              </div>
              <p id="tf-custom-hint" className={`pt-1 text-[10px] ${customBad ? "text-down" : "text-muted"}`}>
                {customBad ? dict.chart.tfCustomBad : dict.chart.tfCustomHint}
              </p>
            </form>
          </div>
        )}
      </div>

      {!intraday && (
        <Link href={pricingHref} className="text-[11px] font-medium text-accent hover:underline">
          {dict.chart.tfLocked} →
        </Link>
      )}

      {(typed || refused) && (
        <span role="status" aria-live="polite"
          className={`tnum rounded border px-2 py-0.5 text-[11px] ${
            refused ? "border-line bg-surface-2 text-muted" : "border-accent text-accent"
          }`}>
          {refused ? dict.chart.tfLocked : `${dict.chart.tfTyping}: ${typed}`}
        </span>
      )}
    </div>
  );
}
