import Link from "next/link";
import { notFound } from "next/navigation";
import { ChartPro } from "@/components/chart/ChartPro";
import { ChartRail } from "@/components/chart/ChartRail";
import { ChartViewed } from "@/components/chart/ChartViewed";
import { PageHeader } from "@/components/editorial";
import { FeedBanner } from "@/components/FeedBanner";
import { PageShell } from "@/components/layout";
import { LiveStamp } from "@/components/LiveStamp";
import { SymbolSearchButton } from "@/components/SymbolSearch";
import { WatchButton } from "@/components/WatchButton";
import { Delta } from "@/components/Delta";
import { getSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/entitlement";
import { activeProvider } from "@/lib/ask/provider";
import { equityPrice } from "@/lib/format";
import { rsi } from "@/lib/ta/indicators";
import { getDict, PATHS, type Dict } from "@/lib/i18n";
import { BAND, getBoard, getTimeframeBars, VN30 } from "@/lib/providers/vnstock";
import { foreignFlowAvailable, getForeignFlow } from "@/lib/providers/ssi";
import type { CompareSeries, RefLine } from "@/components/chart/ChartPro";
import { DEFAULT_TF, timeframe } from "@/lib/chart/timeframes";
import { decodeView } from "@/lib/chart/view-state";
import { INDICATORS } from "@/lib/ta/registry";
import { TimeframePicker } from "@/components/chart/TimeframePicker";
import type { Locale } from "@/lib/types";

/**
 * The chart workspace.
 *
 * Everything the reader can do here is decided from the server-verified tier —
 * the client component receives `tier` and gates its own UI, but the tier itself
 * is never client-supplied.
 */
export async function TerminalView({
  locale, symbol, extra = [], layout = 1, tf, rail, cmp = false, fr = false, view: viewParams,
}: {
  locale: Locale;
  symbol: string;
  /** Additional symbols for a multi-chart layout (Pro). */
  extra?: string[];
  layout?: 1 | 2 | 4;
  /** Chart interval id from the URL. */
  tf?: string;
  /** Rail tab to open (`?rail=ask`) — how the old assistant and watchlist URLs land. */
  rail?: string;
  /** Overlay VNINDEX for relative strength (`?cmp=1`). Gated to Plus. */
  cmp?: boolean;
  /** Foreign net buy/sell pane (`?fr=1`), from SSI FastConnect. Gated to Plus. */
  fr?: boolean;
  /** Raw view params from the URL; decoded and tier-clamped on the server. */
  view?: { type?: string; ind?: string; r?: string };
}) {
  const dict = getDict(locale);
  const sym = symbol.toUpperCase();
  const session = await getSession();
  const tier = session?.tier ?? "anon";

  // Intraday is a paid interval, so the tier decides it on the SERVER. A free
  // reader who types ?tf=5m gets the daily chart, not a 402 — and never the bars.
  const asked = timeframe(tf);
  const view = asked.intraday && !can(tier, "chart:intraday") ? timeframe(DEFAULT_TF) : asked;

  const [barsR, boardR] = await Promise.allSettled([
    getTimeframeBars(sym, view),
    getBoard(),
  ]);

  if (barsR.status === "rejected" || !barsR.value.length) {
    // A symbol we cannot chart at all is a 404; a broken board is not.
    if (!VN30.includes(sym as (typeof VN30)[number])) notFound();
    return (
      <>
        <PageHeader title={sym} subtitle={dict.chart.subtitle} />
        <FeedBanner dict={dict} detail={barsR.status === "rejected" ? String(barsR.reason) : undefined} />
      </>
    );
  }

  const bars = barsR.value;
  const board = boardR.status === "fulfilled" ? boardR.value : [];

  // Multi-chart is Pro. A non-Pro request for a grid silently collapses to one
  // chart rather than erroring — the capability is upsold, not punished.
  const multi = can(tier, "chart:multi");
  const cells = multi ? Math.max(1, Math.min(layout, 4)) : 1;
  const companions = multi ? extra.slice(0, cells - 1) : [];
  const companionBars = await Promise.all(
    companions.map((sym2) => getTimeframeBars(sym2, view).catch(() => [])),
  );
  const last = bars[bars.length - 1];
  const prev = bars[bars.length - 2] ?? last;
  const change = last.c - prev.c;
  const changePct = prev.c ? (change / prev.c) * 100 : 0;

  // VN ceiling/floor (trần/sàn): the session's ±band limits off the reference
  // (previous close). A daily concept, so only on daily+ timeframes.
  const refLines: RefLine[] = view.intraday
    ? []
    : [
        { price: prev.c * (1 + BAND.HOSE), label: dict.stocks.ceiling, dir: "up" },
        { price: prev.c * (1 - BAND.HOSE), label: dict.stocks.floor, dir: "down" },
      ];

  // VNINDEX overlay for relative strength — gated to Plus, URL-driven so it is
  // shareable. Aligned to the symbol's bars by timestamp; a normalised shape,
  // not the price scale.
  const canCompare = can(tier, "chart:compare");
  let compare: CompareSeries | null = null;
  if (cmp && canCompare) {
    const idx = await getTimeframeBars("VNINDEX", view, { kind: "index" }).catch(() => []);
    if (idx.length) {
      const byTs = new Map(idx.map((b) => [b.t, b.c]));
      compare = { label: "VNINDEX", series: bars.map((b) => byTs.get(b.t) ?? null) };
    }
  }

  // Foreign net buy/sell (khối ngoại) from SSI FastConnect — daily only, gated
  // to Plus, and only offered when the owner has wired SSI credentials. Aligned
  // to the bars by trading DAY (sources keep different epochs for the same day).
  const foreignReady = foreignFlowAvailable();
  let foreign: CompareSeries | null = null;
  if (fr && canCompare && foreignReady && !view.intraday) {
    const flow = await getForeignFlow(sym, 250).catch(() => []);
    if (flow.length) {
      const byDate = new Map(flow.map((f) => [f.date, f.netVal]));
      const isoDay = (t: number) =>
        new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(t * 1000));
      foreign = { label: dict.chart.foreignPane, series: bars.map((b) => byDate.get(isoDay(b.t)) ?? null) };
    }
  }

  // The shared view. Decoded HERE rather than in the browser: a hand-typed
  // ?ind= full of paid indicators is trimmed before anything renders, the same
  // fail-closed rule the intraday timeframe follows — never drawn and retracted.
  const chartView = decodeView(
    { type: viewParams?.type, ind: viewParams?.ind, r: viewParams?.r },
    {
      tier,
      known: (id) => INDICATORS.some((d) => d.id === id),
      isFree: (id) => !!INDICATORS.find((d) => d.id === id)?.free,
    },
  );

  // RSI for the alert panel, computed from the bars this page already loaded.
  // Without it an indicator alert simply is not evaluated in the browser — the
  // nightly job still catches it — which is far better than testing "RSI above
  // 70" against a share price of 70.
  const rsiSeries = rsi(bars.map((b) => b.c), 14);
  const rsiNow = rsiSeries[rsiSeries.length - 1];
  const rsiPrev = rsiSeries[rsiSeries.length - 2];
  const rsi14 = typeof rsiNow === "number"
    ? { rsi14: { current: rsiNow, ...(typeof rsiPrev === "number" ? { previous: rsiPrev } : {}) } }
    : undefined;

  return (
    <PageShell
      rail={
        <ChartRail
          locale={locale} dict={dict} symbol={sym} board={board}
          current={last.c} previous={prev.c} tier={tier} isMock={activeProvider() === "mock"}
          initialTab={rail} indicators={rsi14}
        />
      }
    >
      <ChartViewed
        symbol={sym} tf={view.id} intraday={!!view.intraday} layout={cells}
        tier={tier} hasCmp={!!compare} hasFr={!!foreign}
      />
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-[26px] font-semibold tracking-tight">{sym}</h1>
            <WatchButton symbol={sym} addLabel={dict.stocks.addWatch} removeLabel={dict.stocks.removeWatch} />
            <SymbolSearchButton label={dict.chart.changeSymbol} compact />
          </div>
          <p className="mt-0.5 text-[12px] text-muted">HOSE · {dict.common.unit}: {dict.common.thousandVnd}</p>
          {/* Session-aware: the chart was the one live surface with no refresh at
              all, but it must not pulse "live" at a price frozen since 15:00. */}
          <div className="mt-1"><LiveStamp locale={locale} sessionAware /></div>
        </div>
        <div className="text-right">
          <div className="text-[30px] font-semibold leading-none tracking-tight">{equityPrice(last.c, locale)}</div>
          <div className="mt-1.5 text-[13px]"><Delta change={change} changePct={changePct} locale={locale} /></div>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-x-6 gap-y-2">
        <TimeframePicker
          current={view.id}
          base={`/${locale}/${PATHS.terminal[locale]}/${sym}`}
          extraQuery={cells > 1 ? `&layout=${cells}&s=${companions.join(",")}` : ""}
          dict={dict}
          tier={tier}
          pricingHref={`/${locale}/${PATHS.pricing[locale]}?plan=plus`}
        />
        <LayoutSwitcher locale={locale} dict={dict} symbol={sym} extra={extra} layout={cells} multi={multi} tf={view.id} />
        <CompareToggle
          locale={locale} dict={dict} symbol={sym} tf={view.id}
          on={!!compare} canCompare={canCompare} frOn={!!foreign}
          extraQuery={cells > 1 ? `&layout=${cells}&s=${companions.join(",")}` : ""}
        />
        {foreignReady && !view.intraday && (
          <ForeignToggle
            locale={locale} dict={dict} symbol={sym} tf={view.id}
            on={!!foreign} canForeign={canCompare} cmpOn={!!compare}
            extraQuery={cells > 1 ? `&layout=${cells}&s=${companions.join(",")}` : ""}
          />
        )}
      </div>

      <div className={`grid gap-4 ${cells > 1 ? "xl:grid-cols-2" : ""}`}>
        <div className="card min-w-0 p-4">
          <ChartPro bars={bars} symbol={sym} locale={locale} dict={dict} tier={tier} digits={2} intraday={view.intraday} refLines={refLines} compare={compare} foreign={foreign} initialView={chartView} />
        </div>
        {companions.map((sym2, i) =>
          companionBars[i].length ? (
            <div key={sym2} className="card min-w-0 p-4">
              <h2 className="mb-2 text-[14px] font-semibold tracking-tight">{sym2}</h2>
              <ChartPro bars={companionBars[i]} symbol={sym2} locale={locale} dict={dict} tier={tier} digits={2} intraday={view.intraday} />
            </div>
          ) : (
            <div key={sym2} className="card p-4"><FeedBanner dict={dict} /></div>
          ),
        )}
      </div>

    </PageShell>
  );
}


/**
 * Layout control. The chosen symbols live in the URL so a workspace is
 * shareable and survives a reload — the alternative, hidden client state, makes
 * a multi-chart setup impossible to send to a colleague.
 */
function LayoutSwitcher({
  locale, dict, symbol, extra, layout, multi, tf,
}: {
  locale: Locale; dict: Dict; symbol: string; extra: string[]; layout: number; multi: boolean; tf: string;
}) {
  const defaults = VN30.filter((s) => s !== symbol).slice(0, 3);
  const href = (n: number) => {
    const path = `/${locale}/${PATHS.terminal[locale]}/${symbol}?tf=${encodeURIComponent(tf)}`;
    if (n === 1) return path;
    const picks = [...extra, ...defaults].filter((v, i, a) => a.indexOf(v) === i).slice(0, n - 1);
    return `${path}&layout=${n}&s=${picks.join(",")}`;
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted">{dict.chart.layout}</span>
      <div role="group" aria-label={dict.chart.layout} className="flex rounded border border-line">
        {[1, 2, 4].map((n) => {
          const locked = !multi && n > 1;
          const active = layout === n;
          return locked ? (
            <span key={n} title={dict.chart.layoutLocked}
              className="cursor-not-allowed px-2.5 py-1 text-[12px] font-medium text-muted opacity-55">
              🔒 {n}
            </span>
          ) : (
            <Link key={n} href={href(n)} aria-current={active ? "page" : undefined}
              className={`px-2.5 py-1 text-[12px] font-medium first:rounded-l last:rounded-r ${
                active ? "bg-surface-2 text-ink" : "text-ink-2 hover:text-ink"
              }`}>
              {n}
            </Link>
          );
        })}
      </div>
      {!multi && (
        <Link href={`/${locale}/${PATHS.pricing[locale]}?plan=pro`} className="text-[11px] font-medium text-accent hover:underline">
          {dict.chart.layoutLocked} →
        </Link>
      )}
    </div>
  );
}

/**
 * VNINDEX overlay toggle. URL-driven (`?cmp=1`) so the compared view is
 * shareable and re-renders server-side. Gated: a non-Plus reader sees a lock
 * that upsells rather than a control that 402s.
 */
function CompareToggle({
  locale, dict, symbol, tf, on, canCompare, frOn, extraQuery,
}: {
  locale: Locale; dict: Dict; symbol: string; tf: string; on: boolean; canCompare: boolean; frOn: boolean; extraQuery: string;
}) {
  // Preserve the foreign-flow flag so the two overlays are independent toggles.
  const base = `/${locale}/${PATHS.terminal[locale]}/${symbol}?tf=${encodeURIComponent(tf)}${extraQuery}${frOn ? "&fr=1" : ""}`;
  if (!canCompare) {
    return (
      <Link href={`/${locale}/${PATHS.pricing[locale]}?plan=plus`} title={dict.chart.compareLock}
        className="text-[11px] font-medium text-accent hover:underline">
        🔒 {dict.chart.compareOn} →
      </Link>
    );
  }
  return (
    <Link
      href={on ? base : `${base}&cmp=1`}
      aria-pressed={on}
      className={`rounded border px-2.5 py-1 text-[12px] font-medium ${
        on ? "border-accent bg-accent text-page" : "border-line text-ink-2 hover:text-ink"
      }`}
    >
      {on ? dict.chart.compareOff : dict.chart.compareOn}
    </Link>
  );
}

/** Foreign net buy/sell pane toggle (?fr=1). Same URL-driven, gated pattern. */
function ForeignToggle({
  locale, dict, symbol, tf, on, canForeign, cmpOn, extraQuery,
}: {
  locale: Locale; dict: Dict; symbol: string; tf: string; on: boolean; canForeign: boolean; cmpOn: boolean; extraQuery: string;
}) {
  const base = `/${locale}/${PATHS.terminal[locale]}/${symbol}?tf=${encodeURIComponent(tf)}${extraQuery}${cmpOn ? "&cmp=1" : ""}`;
  if (!canForeign) {
    return (
      <Link href={`/${locale}/${PATHS.pricing[locale]}?plan=plus`} title={dict.chart.foreignLock}
        className="text-[11px] font-medium text-accent hover:underline">
        🔒 {dict.chart.foreignOn} →
      </Link>
    );
  }
  return (
    <Link
      href={on ? base : `${base}&fr=1`}
      aria-pressed={on}
      className={`rounded border px-2.5 py-1 text-[12px] font-medium ${
        on ? "border-accent bg-accent text-page" : "border-line text-ink-2 hover:text-ink"
      }`}
    >
      {on ? dict.chart.foreignOff : dict.chart.foreignOn}
    </Link>
  );
}
