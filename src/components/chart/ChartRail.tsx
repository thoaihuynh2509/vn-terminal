"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AlertPanel } from "@/components/chart/AlertPanel";
import { AskBox } from "@/components/AskBox";
import { Sparkline } from "@/components/Sparkline";
import { WATCH_KEY, parseWatchlist, useWatchlistRaw } from "@/components/WatchButton";
import { useStored, writeStored } from "@/lib/browser-store";
import { STREAK_KEY, bumpStreak, parseStreak } from "@/lib/retention/streak";
import { isEditable } from "@/lib/chart/tf-keys";
import { track } from "@/lib/analytics/posthog";
import { useRouter } from "next/navigation";
import { can } from "@/lib/auth/entitlement";
import { dirOf, equityPrice, pct } from "@/lib/format";
import { PATHS, type Dict } from "@/lib/i18n";
import { useDismiss } from "@/lib/ui/use-dismiss";
import type { Locale, Quote, Tier } from "@/lib/types";

type Tab = "watch" | "alerts" | "ask";
const TABS: Tab[] = ["watch", "alerts", "ask"];
const TAB_KEY = "rail:tab";

const asTab = (v: string | null | undefined): Tab | null => (TABS.includes(v as Tab) ? (v as Tab) : null);

/**
 * The chart's side panel: watchlist, alerts and the assistant as three tabs
 * on one card, so the reader never leaves the chart to use any of them.
 *
 * Below `lg` the card becomes a tab bar pinned to the bottom of the screen and
 * the panel a sheet above it — the chart keeps the whole viewport, and the
 * rail is one tap away instead of a scroll below the fold.
 */
export function ChartRail({
  locale, dict, symbol, board, current, previous, tier, isMock, initialTab, indicators,
}: {
  locale: Locale; dict: Dict; symbol: string; board: Quote[];
  current: number; previous: number; tier: Tier; isMock: boolean;
  /** Tab asked for in the URL. Wins until the reader picks one themselves. */
  initialTab?: string;
  /** Indicator readings for alerts that watch one, keyed by `indicatorKey`. */
  indicators?: Record<string, { current: number; previous?: number }>;
}) {
  const stored = useStored(TAB_KEY);
  // The URL's choice is held in state, not written to storage: a shared link
  // should open on its tab without overwriting what this reader last chose.
  const [forced, setForced] = useState<Tab | null>(() => asTab(initialTab));
  const tab: Tab = forced ?? asTab(stored) ?? "watch";
  const label: Record<Tab, string> = { watch: dict.chart.tabWatch, alerts: dict.chart.tabAlerts, ask: dict.chart.tabAsk };

  // Sheet state only matters below `lg`; the desktop panel is always shown.
  // A URL that names a tab opens the sheet — that is what the link promised.
  const [sheet, setSheet] = useState(() => asTab(initialTab) !== null);
  const wrap = useRef<HTMLElement>(null);
  const closeSheet = useCallback(() => setSheet(false), []);
  useDismiss(wrap, sheet, closeSheet);

  // The pinned bar would otherwise cover the last 44px of the footer.
  useEffect(() => {
    document.body.classList.add("pb-11", "lg:pb-0");
    return () => document.body.classList.remove("pb-11", "lg:pb-0");
  }, []);

  // ── the quiet habit loop ──────────────────────────────────────────────────
  // Counted on the client because it is the reader's own habit, kept in their
  // own browser; nothing about it is worth a row in our database.
  const router = useRouter();
  const storedStreak = useStored(STREAK_KEY);
  const streak = parseStreak(storedStreak);
  useEffect(() => {
    const next = bumpStreak(parseStreak(storedStreak));
    // bumpStreak returns the SAME object for a second visit the same day, so a
    // reader who leaves the chart open does not write once per render.
    if (next === parseStreak(storedStreak)) return;
    const current = parseStreak(storedStreak);
    if (current && current.lastDay === next.lastDay && current.count === next.count) return;
    writeStored(STREAK_KEY, JSON.stringify(next));
    track("streak_day", { streak: next.count });
    // Effect deps intentionally exclude `streak`: this runs off the stored
    // value, and depending on the parsed object would re-run every render.
  }, [storedStreak]);

  // j/k walks the watchlist without leaving the chart — the two-minute morning
  // review is "next, next, next", and reaching for the mouse each time is what
  // makes people stop doing it.
  const storedWatch = useStored(WATCH_KEY);
  useEffect(() => {
    const list = parseWatchlist(storedWatch);
    if (list.length < 2) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "j" && e.key !== "k") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isEditable(e.target as { tagName?: string; isContentEditable?: boolean } | null)) return;
      const here = list.indexOf(symbol.toUpperCase());
      const step = e.key === "j" ? 1 : -1;
      // Wraps, so the list is a loop rather than a dead end at either end.
      const next = list[(((here === -1 ? 0 : here) + step) % list.length + list.length) % list.length];
      if (!next || next === symbol.toUpperCase()) return;
      e.preventDefault();
      router.push(`/${locale}/${PATHS.terminal[locale]}/${next}`);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [storedWatch, symbol, locale, router]);

  const pick = (t: Tab) => {
    setForced(null);
    writeStored(TAB_KEY, t);
    setSheet(!(sheet && t === tab)); // the open tab toggles its sheet closed
  };

  return (
    <section ref={wrap} className="card contents lg:block">
      <div role="tablist" aria-label={dict.chart.workspace}
        className="fixed inset-x-0 bottom-0 z-40 flex h-11 border-t border-line bg-surface lg:static lg:h-auto lg:border-b lg:border-t-0">
        {TABS.map((t) => (
          <button key={t} type="button" role="tab" id={`rail-tab-${t}`} aria-selected={tab === t}
            aria-controls={`rail-panel-${t}`} onClick={() => pick(t)}
            className={`flex-1 px-2 text-[12px] font-semibold lg:py-2 ${
              tab === t ? "border-b-2 border-accent text-ink" : "text-ink-2 hover:text-ink"
            }`}>
            {label[t]}
          </button>
        ))}
        {streak && streak.count > 1 && (
          <span className="hidden shrink-0 items-center px-2 text-[11px] text-muted lg:flex"
            title={dict.chart.streak.replace("{n}", String(streak.count))}>
            {dict.chart.streak.replace("{n}", String(streak.count))}
          </span>
        )}
      </div>
      <div role="tabpanel" id={`rail-panel-${tab}`} aria-labelledby={`rail-tab-${tab}`}
        className={`${sheet ? "fixed" : "hidden"} inset-x-0 bottom-11 z-40 max-h-[70dvh] overflow-y-auto rounded-t-[10px] border-t border-line bg-surface p-3.5 shadow-lg lg:static lg:block lg:max-h-none lg:overflow-visible lg:rounded-none lg:border-0 lg:shadow-none`}>
        <div className="mb-2 flex items-center justify-between lg:hidden">
          <span className="text-[12px] font-semibold">{label[tab]}</span>
          <button type="button" onClick={closeSheet} aria-label={dict.chart.closeRail}
            className="grid h-7 w-7 place-items-center rounded text-[14px] text-ink-2 hover:bg-surface-2 hover:text-ink">
            <span aria-hidden="true">×</span>
          </button>
        </div>
        {tab === "watch" && <WatchTab locale={locale} dict={dict} symbol={symbol} board={board} />}
        {tab === "alerts" && (
          <AlertPanel indicators={indicators} symbol={symbol} current={current} previous={previous} locale={locale} dict={dict} tier={tier} />
        )}
        {tab === "ask" && (
          can(tier, "use:ai-assistant") ? (
            <AskBox locale={locale} isMock={isMock} symbol={symbol} compact />
          ) : (
            <div>
              <p className="text-[12px] leading-relaxed text-ink-2">{dict.paywall.aiLocked}</p>
              <Link href={`/${locale}/${PATHS.pricing[locale]}?plan=plus`}
                className="mt-3 inline-block rounded border border-line bg-surface-2 px-3 py-1.5 text-[12px] font-medium hover:bg-surface">
                {dict.paywall.seePlans}
              </Link>
            </div>
          )
        )}
      </div>
    </section>
  );
}

/** Starred names first, then the rest of the board — one list, no empty state. */
function WatchTab({ locale, dict, symbol, board }: { locale: Locale; dict: Dict; symbol: string; board: Quote[] }) {
  const raw = useWatchlistRaw();
  const starred = useMemo(() => parseWatchlist(raw), [raw]);
  const mine = board.filter((q) => starred.includes(q.symbol));
  const rest = board.filter((q) => !starred.includes(q.symbol));

  const row = (q: Quote) => {
    const d = dirOf(q.changePct, 2);
    const on = q.symbol === symbol;
    return (
      <li key={q.symbol}>
        <Link href={`/${locale}/${PATHS.terminal[locale]}/${q.symbol}`} aria-current={on ? "page" : undefined}
          className={`flex items-center justify-between gap-2 py-1.5 text-[12px] ${on ? "font-semibold text-ink" : "text-ink-2 hover:text-accent"}`}>
          <span>{q.symbol}</span>
          {q.spark && q.spark.length > 2 && <Sparkline points={q.spark} dir={d} width={44} height={16} />}
          <span className="tnum shrink-0 text-right">
            {q.price ? equityPrice(q.price, locale) : "—"}
            <span className={`ml-1.5 ${d === "up" ? "text-up" : d === "down" ? "text-down" : "text-ink-2"}`}>
              {q.price ? pct(q.changePct, locale) : ""}
            </span>
          </span>
        </Link>
      </li>
    );
  };

  return (
    <div className="max-h-[60vh] overflow-y-auto">
      {mine.length ? (
        <ul className="divide-y divide-line">{mine.map(row)}</ul>
      ) : (
        <p className="pb-2 text-[12px] text-muted">{dict.chart.watchHint}</p>
      )}
      {rest.length > 0 && (
        <>
          <p className="mt-2 border-t border-line pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted">VN30</p>
          <ul className="divide-y divide-line">{rest.map(row)}</ul>
        </>
      )}
    </div>
  );
}
