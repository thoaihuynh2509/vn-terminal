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
import { getSession, sessionsAvailable } from "@/lib/auth/session";
import { can } from "@/lib/auth/entitlement";
import { activeProvider } from "@/lib/ask/provider";
import { freeAsksToShow } from "@/lib/ask/meter";
import { dateOnly, equityPrice } from "@/lib/format";
import { rsi } from "@/lib/ta/indicators";
import { getDict, PATHS, type Dict } from "@/lib/i18n";
import { getBoard, getTimeframeBars } from "@/lib/providers/vnstock";
import { HOSE_SYMBOLS, bandOf, exchangeOf } from "@/lib/universe";
import { foreignFlowAvailable, getForeignFlow } from "@/lib/providers/ssi";
import { getCorpEvents } from "@/lib/providers/events";
import { getCoinBars } from "@/lib/providers/crypto";
import { cryptoEnabled } from "@/lib/flags";
import { ChartSyncProvider } from "@/components/chart/ChartSync";
import { SavedLayoutBar } from "@/components/chart/SavedLayoutBar";
import { decodeTemplate } from "@/lib/chart/layouts";
import { chartSource, seriesKey } from "@/lib/chart/series";
import { dbAvailable, getDb } from "@/lib/db";
import type { Bar } from "@/lib/types";
import type { CompareSeries, RefLine } from "@/components/chart/ChartPro";
import { DEFAULT_TF, timeframe } from "@/lib/chart/timeframes";
import { decodeView } from "@/lib/chart/view-state";
import { parseCompare } from "@/lib/chart/compare";
import { getBreadth } from "@/lib/providers/breadth";
import { alignBreadth } from "@/lib/breadth";
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
/**
 * Points we recorded ourselves, as chart bars.
 *
 * Returns an empty array rather than throwing when the database is unavailable:
 * a gold chart with no history yet and a gold chart we cannot reach look the
 * same to the reader, and both are "no history to show" rather than an error.
 */
/**
 * Coin bars, already `Bar`-shaped by the provider.
 *
 * Daily only: the upstream's `market_chart` is a daily close series, so the
 * intraday intervals a reader can pick for an equity have nothing to serve here
 * and the chart stays on the one interval that exists.
 */
/** A malformed escape is not a reason to fail the page; use it as typed. */
function safeDecode(v: string): string {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}

async function cryptoBars(id: string): Promise<Bar[]> {
  if (!cryptoEnabled()) return [];
  try {
    return await getCoinBars(id, 365);
  } catch {
    return [];
  }
}

async function recordedBars(code: string): Promise<Bar[]> {
  if (!dbAvailable()) return [];
  try {
    const db = await getDb();
    const points = await db.series.range(seriesKey(code), 2000);
    return points.map((p) => ({ t: p.t, o: p.o, h: p.h, l: p.l, c: p.c, v: p.v ?? 0 }));
  } catch {
    return [];
  }
}

export async function TerminalView({
  locale, symbol, extra = [], layout = 1, tf, rail, cmp, fr = false, br = false, view: viewParams, tpl,
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
  /** Symbols to overlay (`?cmp=VNINDEX,HPG`; legacy `?cmp=1` means VNINDEX). */
  cmp?: string;
  /** Foreign net buy/sell pane (`?fr=1`), from SSI FastConnect. Gated to Plus. */
  fr?: boolean;
  /** VN30 breadth pane (`?br=1`). Gated to Pro. */
  br?: boolean;
  /** Raw view params from the URL; decoded and tier-clamped on the server. */
  view?: { type?: string; ind?: string; r?: string; sc?: string };
  /** A shared setup, applied when the URL carries no view of its own. */
  tpl?: string;
}) {
  const dict = getDict(locale);
  /**
   * Decoded FIRST, because Next hands the route segment percent-encoded.
   *
   * Every equity symbol is plain letters and so survives either way, which is
   * exactly why this went unnoticed: it only bites the namespaced symbols —
   * `GOLD:SJC` arrives as `GOLD%3ASJC`, is classified as an equity, finds no
   * bars, and 404s.
   */
  const sym = safeDecode(symbol).toUpperCase();
  const session = await getSession();
  const tier = session?.tier ?? "anon";

  /**
   * A shared setup fills in only what the URL did NOT say.
   *
   * A template must never override a parameter the reader can see in their own
   * address bar: if they edited the timeframe after opening the link, that is
   * their chart now, and silently reverting it would be the template fighting
   * the reader.
   */
  const shared = tpl ? decodeTemplate(tpl) : null;
  if (shared) {
    viewParams = {
      type: viewParams?.type ?? shared.type,
      ind: viewParams?.ind ?? (shared.ind.length ? shared.ind.join(",") : undefined),
      r: viewParams?.r ?? shared.range ?? undefined,
      sc: viewParams?.sc ?? shared.scale,
    };
    if (!tf) tf = shared.tf;
    if (!cmp && shared.cmp.length) cmp = shared.cmp.join(",");
    if (!extra.length && shared.extra.length) { extra = shared.extra; layout = shared.grid; }
  }

  // Intraday is a paid interval, so the tier decides it on the SERVER. A free
  // reader who types ?tf=5m gets the daily chart, not a 402 — and never the bars.
  const asked = timeframe(tf);
  const view = asked.intraday && !can(tier, "chart:intraday") ? timeframe(DEFAULT_TF) : asked;

  /**
   * Gold is charted from OUR OWN recorded points, because the upstream
   * publishes a live snapshot and no history. That makes it a different fetch,
   * and a different empty state: an equity with no bars is a broken feed, while
   * gold with no bars simply means the recording has not started yet.
   */
  const source = chartSource(sym);
  const recorded = source.kind === "recorded" ? source.code : null;
  const [barsR, boardR] = await Promise.allSettled([
    source.kind === "recorded" ? recordedBars(source.code)
      : source.kind === "crypto" ? cryptoBars(source.id)
      : getTimeframeBars(sym, view),
    getBoard(),
  ]);

  // A recorded series with nothing in it yet is not an error — it is a feature
  // that starts accruing on the day the cron first runs, and saying so is more
  // honest than a feed banner blaming an upstream that was never asked.
  if (source.kind !== "equity" && (barsR.status === "rejected" || !barsR.value.length)) {
    return (
      <>
        <PageHeader title={sym} subtitle={dict.chart.subtitle} />
        <p className="card p-4 text-[13px] text-ink-2">{dict.chart.seriesEmpty}</p>
      </>
    );
  }

  if (barsR.status === "rejected" || !barsR.value.length) {
    // A symbol we cannot chart at all is a 404; a broken board is not.
    // 404 only when we do not recognise the symbol at all. Keying this on VN30
    // would have rejected every HNX and UPCOM name the moment they became
    // chartable.
    if (!exchangeOf(sym)) notFound();
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
  // The band is the EXCHANGE's, not always HOSE's. Every symbol used to be drawn
  // with HOSE's ±7%, so an HNX stock (±10%) or an UPCOM one (±15%) showed a
  // ceiling well inside where it could actually trade — a wrong number in the
  // one place a VN trader looks first. When the exchange is unknown we draw
  // NOTHING: a missing pair of lines is a gap the reader can see, a wrong pair
  // is one they cannot.
  const band = bandOf(sym);
  const refLines: RefLine[] = view.intraday || band === null
    ? []
    : [
        { price: prev.c * (1 + band), label: dict.stocks.ceiling, dir: "up" },
        { price: prev.c * (1 - band), label: dict.stocks.floor, dir: "down" },
      ];

  // VNINDEX overlay for relative strength — gated to Plus, URL-driven so it is
  // shareable. Aligned to the symbol's bars by timestamp; a normalised shape,
  // not the price scale.
  const canCompare = can(tier, "chart:compare");
  // Capped by tier inside parseCompare, so a hand-typed ?cmp= with five symbols
  // cannot fan out into five upstream fetches.
  const compareSymbols = canCompare ? parseCompare(cmp, tier, sym) : [];
  const compareSeries = await Promise.all(
    compareSymbols.map(async (other) => {
      // An index and a stock come from different endpoints; the only reliable
      // way to tell them apart here is that indices are not listed equities.
      const kind = exchangeOf(other) ? ("stock" as const) : ("index" as const);
      const other_bars = await getTimeframeBars(other, view, { kind }).catch(() => []);
      if (!other_bars.length) return null;
      const byTs = new Map(other_bars.map((b) => [b.t, b.c]));
      return { label: other, series: bars.map((b) => byTs.get(b.t) ?? null) };
    }),
  );
  // A symbol whose feed failed is dropped rather than drawn as a gap that looks
  // like the stock stopped trading.
  const compare: CompareSeries[] = compareSeries.filter((c): c is CompareSeries => c !== null);

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

  // Corporate events (cổ tức, phát hành) as x-axis markers. Free, and daily
  // only: an intraday window almost never contains an ex-date, so the fetch
  // would be noise. Failure is already swallowed by the provider — a chart
  // without markers beats no chart.
  const events = view.intraday ? [] : await getCorpEvents(sym, locale);

  /**
   * Per-companion reference lines and events.
   *
   * Each uses its OWN exchange band and its OWN previous close — reusing the
   * main symbol's would draw an HNX stock's ceiling at a HOSE price, which is
   * the exact bug P2-2 fixed for the primary chart.
   */
  const companionRefs: RefLine[][] = companionBars.map((cb, i) => {
    const cBand = bandOf(companions[i]);
    const cPrev = cb[cb.length - 2] ?? cb[cb.length - 1];
    if (view.intraday || cBand === null || !cPrev) return [];
    return [
      { price: cPrev.c * (1 + cBand), label: dict.stocks.ceiling, dir: "up" as const },
      { price: cPrev.c * (1 - cBand), label: dict.stocks.floor, dir: "down" as const },
    ];
  });
  const companionEvents = view.intraday
    ? companions.map(() => [])
    : await Promise.all(companions.map((c) => getCorpEvents(c, locale)));

  // The shared view. Decoded HERE rather than in the browser: a hand-typed
  // ?ind= full of paid indicators is trimmed before anything renders, the same
  // fail-closed rule the intraday timeframe follows — never drawn and retracted.
  const chartView = decodeView(
    { type: viewParams?.type, ind: viewParams?.ind, r: viewParams?.r, sc: viewParams?.sc },
    {
      tier,
      known: (id) => INDICATORS.some((d) => d.id === id),
      isFree: (id) => !!INDICATORS.find((d) => d.id === id)?.free,
    },
  );

  // Market breadth — the Pro pane. An index is capitalisation-weighted, so
  // VNINDEX can rise on two large banks while most of the board falls; this is
  // the question that answers, and an index chart structurally cannot. Daily
  // only: breadth is a daily measure and recomputing it per intraday interval
  // would multiply thirty upstream fetches for a number that does not change.
  let breadth: CompareSeries | null = null;
  if (br && can(tier, "chart:multi") && !view.intraday) {
    const points = await getBreadth().catch(() => []);
    if (points.length) {
      breadth = { label: dict.chart.breadthPane, series: alignBreadth(points, bars) };
    }
  }

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
          freeAsks={freeAsksToShow(tier, session?.asks, sessionsAvailable())}
        />
      }
    >
      <ChartViewed
        symbol={sym} tf={view.id} intraday={!!view.intraday} layout={cells}
        tier={tier} hasCmp={compare.length > 0} hasFr={!!foreign}
      />
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-[26px] font-semibold tracking-tight">{sym}</h1>
            <WatchButton symbol={sym} addLabel={dict.stocks.addWatch} removeLabel={dict.stocks.removeWatch} />
            <SymbolSearchButton label={dict.chart.changeSymbol} compact />
          </div>
          {/* A recorded series says where its history STARTS, because it has no
              upstream past and a chart that stops abruptly at the left edge
              otherwise reads as missing data rather than as the beginning. */}
          <p className="mt-0.5 text-[12px] text-muted">
            {recorded
              ? dict.chart.seriesFrom.replace("{d}", dateOnly(bars[0].t, locale))
              : `${exchangeOf(sym) ?? dict.common.noData} · ${dict.common.unit}: ${dict.common.thousandVnd}`}
          </p>
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
        {/* Saved setups are a click away here; the rail stays where they are
            managed. Switching between them is a thing a reader does constantly
            and it should not cost opening a panel first. */}
        <SavedLayoutBar locale={locale} dict={dict} current={sym} />
        <CompareToggle
          locale={locale} dict={dict} symbol={sym} tf={view.id}
          on={compare.length > 0} canCompare={canCompare} frOn={!!foreign}
          extraQuery={cells > 1 ? `&layout=${cells}&s=${companions.join(",")}` : ""}
        />
        {!view.intraday && (
          <BreadthToggle
            locale={locale} dict={dict} symbol={sym} tf={view.id}
            on={!!breadth} canBreadth={can(tier, "chart:multi")}
            extraQuery={`${cells > 1 ? `&layout=${cells}&s=${companions.join(",")}` : ""}${compare.length ? `&cmp=${compare.map((c) => c.label).join(",")}` : ""}${foreign ? "&fr=1" : ""}`}
          />
        )}
        {foreignReady && !view.intraday && (
          <ForeignToggle
            locale={locale} dict={dict} symbol={sym} tf={view.id}
            on={!!foreign} canForeign={canCompare} cmpOn={!!compare}
            extraQuery={cells > 1 ? `&layout=${cells}&s=${companions.join(",")}` : ""}
          />
        )}
      </div>

      {/* One provider around the whole grid: the cells share the hovered MOMENT,
          so a crosshair on one lands on the same session in every other. A
          single chart is not wrapped, so the common case pays nothing. */}
      <ChartSyncProvider>
      <div className={`grid gap-4 ${cells > 1 ? "xl:grid-cols-2" : ""}`}>
        <div className="card min-w-0 p-4">
          <ChartPro bars={bars} symbol={sym} locale={locale} dict={dict} tier={tier} digits={2} intraday={view.intraday} refLines={refLines} compare={compare} foreign={foreign} breadth={breadth} events={events} initialView={chartView} tf={view.id} />
        </div>
        {companions.map((sym2, i) =>
          companionBars[i].length ? (
            <div key={sym2} className="card min-w-0 p-4">
              <h2 className="mb-2 text-[14px] font-semibold tracking-tight">{sym2}</h2>
              {/* Companions get their OWN ceiling/floor, computed from their own
                  previous close and their own exchange's band. They were drawn
                  bare, which made a 4-up grid three charts missing the first
                  thing a VN trader looks for. */}
              <ChartPro bars={companionBars[i]} symbol={sym2} locale={locale} dict={dict} tier={tier} digits={2} intraday={view.intraday} refLines={companionRefs[i]} events={companionEvents[i]} tf={view.id} />
            </div>
          ) : (
            <div key={sym2} className="card p-4"><FeedBanner dict={dict} /></div>
          ),
        )}
      </div>
      </ChartSyncProvider>

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
  // Companions for an empty grid slot come from the large-cap basket, which
  // is what a reader most likely wants beside their symbol.
  const defaults = HOSE_SYMBOLS.filter((s) => s !== symbol).slice(0, 3);
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

/** VN30 breadth pane toggle (?br=1). Pro — it is the flagship of that tier. */
function BreadthToggle({
  locale, dict, symbol, tf, on, canBreadth, extraQuery,
}: {
  locale: Locale; dict: Dict; symbol: string; tf: string; on: boolean; canBreadth: boolean; extraQuery: string;
}) {
  const base = `/${locale}/${PATHS.terminal[locale]}/${symbol}?tf=${encodeURIComponent(tf)}${extraQuery}`;
  if (!canBreadth) {
    return (
      <Link href={`/${locale}/${PATHS.pricing[locale]}?plan=pro`} title={dict.chart.breadthLock}
        className="text-[11px] font-medium text-accent hover:underline">
        🔒 {dict.chart.breadthOn} →
      </Link>
    );
  }
  return (
    <Link href={on ? base : `${base}&br=1`} aria-pressed={on}
      className={`rounded border px-2.5 py-1 text-[12px] font-medium ${
        on ? "border-accent bg-accent text-page" : "border-line text-ink-2 hover:text-ink"
      }`}>
      {on ? dict.chart.breadthOff : dict.chart.breadthOn}
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
