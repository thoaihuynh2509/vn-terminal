"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { pinBelow } from "./tv/usePopover";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { can } from "@/lib/auth/entitlement";
import { byGroup, GROUPS, isCustom, parseCustom, timeframe, TIMEFRAMES, type TfGroup, type Timeframe } from "@/lib/chart/timeframes";
import { isBufferKey, isEditable, resolveTyped, stepTimeframe } from "@/lib/chart/tf-keys";
import { track } from "@/lib/analytics/posthog";
import type { Dict } from "@/lib/i18n";
import type { Tier } from "@/lib/types";

/** TradingView's toolbar shows the daily, weekly and monthly intervals by their letter. */
const TV_LABEL: Record<string, string> = { "1D": "D", "1W": "W", "1M": "M" };

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
  current, base, extraQuery, dict, tier, pricingHref, variant = "pills",
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
  /** `menu` is TradingView's single interval button; the list and the shortcuts are the same. */
  variant?: "pills" | "menu";
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
    // The menu variant is pinned to the viewport, so it closes when the page moves under it.
    const pinned = variant === "menu";
    const onScroll = (e: Event) => { if (!(e.target instanceof Node && wrap.current?.contains(e.target))) setOpen(false); };
    const onResize = () => setOpen(false);
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    if (pinned) {
      window.addEventListener("scroll", onScroll, true);
      window.addEventListener("resize", onResize);
    }
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open, variant]);

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
  const seg = "px-3 py-1.5 font-mono text-[12px] font-medium transition-colors";

  // The quick row always contains the current interval. Without this, choosing
  // "3 months" from the menu leaves every visible pill unselected and the reader
  // cannot see what the chart is showing.
  const builtIn = TIMEFRAMES.filter((t) => QUICK.includes(t.id) || t.id === active.id);
  const pills = isCustom(active.id) ? [...builtIn, active] : builtIn;

  const menuMode = variant === "menu";
  return (
    <div className="flex flex-wrap items-center gap-2">
      {!menuMode && (
        <span className="font-mono text-[11px] font-medium uppercase tracking-[0.1em] text-muted">
          {dict.chart.timeframe}
        </span>
      )}

      {/* Pills and the full list share one border so they read as one control
          rather than two that happen to sit side by side. */}
      <div ref={wrap} className="relative">
        {menuMode ? (
          <div role="group" aria-label={dict.chart.timeframe} className="flex">
            <span aria-current="page" className="sr-only">{active.id}</span>
            <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="menu"
              title={dict.chart.timeframe}
              className="tnum flex h-8 items-center gap-1 rounded-md px-2 text-[13px] font-semibold text-tv-text hover:bg-tv-hover">
              {TV_LABEL[active.id] ?? active.id}
              <span className="sr-only">{dict.chart.timeframe}</span>
            </button>
          </div>
        ) : (
        <div role="group" aria-label={dict.chart.timeframe} className="flex overflow-hidden rounded-[9px] border border-line bg-surface">
          {pills.map((t) => {
            const on = t.id === active.id;
            return locked(t) ? (
              <span key={t.id} title={dict.chart.tfLocked} aria-disabled="true"
                className={`${seg} tnum cursor-not-allowed text-muted opacity-60`}>
                🔒 {t.id}
              </span>
            ) : (
              <Link key={t.id} href={href(t.id)} aria-current={on ? "page" : undefined}
                onClick={() => { if (!on) track("chart_tf_changed", { from: active.id, to: t.id, intraday: !!t.intraday }); }}
                className={`${seg} tnum ${
                  on ? "bg-btn font-semibold text-btn-ink" : "text-ink-2 hover:bg-page hover:text-ink"
                }`}>
                {t.id}
              </Link>
            );
          })}
          <button type="button" onClick={() => setOpen(!open)}
            aria-expanded={open} aria-haspopup="menu"
            className="border-l border-line px-2.5 py-1.5 text-[10px] text-ink-2 hover:bg-page hover:text-ink">
            <span aria-hidden="true">▾</span>
            <span className="sr-only">{dict.chart.timeframe}</span>
          </button>
        </div>
        )}

        {open && (
          <div ref={menuMode ? pinBelow : undefined} role="menu" aria-label={dict.chart.timeframe}
            className={`absolute left-0 top-full z-30 mt-1.5 max-h-[60vh] w-52 overflow-y-auto ${
              menuMode ? "rounded-md border border-tv-border bg-tv-bg text-tv-text shadow-xl" : "rounded-xl border border-line bg-surface shadow-lg"}`}>
            {GROUPS.map((g) => (
              <div key={g} className="border-b border-line last:border-b-0">
                <p className="px-3 pb-1 pt-2 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">
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
                            on ? "bg-page font-semibold text-ink" : "text-ink-2"
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
                  className="tnum w-full min-w-0 rounded-lg border border-line bg-page px-2 py-1 text-[12px]"
                />
                <button type="submit"
                  className="shrink-0 rounded-lg border border-line px-2 py-1 text-[12px] font-medium text-ink-2 hover:bg-surface-2 hover:text-ink">
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

      {!intraday && !menuMode && (
        <Link href={pricingHref} className="text-[11px] font-medium text-accent hover:underline">
          {dict.chart.tfLocked} →
        </Link>
      )}

      {(typed || refused) && (
        <span role="status" aria-live="polite"
          className={`tnum rounded-lg border px-2 py-0.5 text-[11px] ${
            refused ? "border-line bg-page text-muted" : "border-accent text-accent"
          }`}>
          {refused ? dict.chart.tfLocked : `${dict.chart.tfTyping}: ${typed}`}
        </span>
      )}
    </div>
  );
}
