import { notFound } from "next/navigation";
import { TradingChart } from "@/components/chart/tv/TradingChart";
import { ChartRail } from "@/components/chart/ChartRail";
import { ChartViewed } from "@/components/chart/ChartViewed";
import { PageHeader } from "@/components/editorial";
import { FeedBanner } from "@/components/FeedBanner";
import { JsonLd } from "@/components/JsonLd";
import { SymbolNarrative } from "@/components/SymbolNarrative";
import { breadcrumbLd, symbolTrail } from "@/lib/seo";
import { siteUrl } from "@/lib/site";
import { LiveStamp } from "@/components/LiveStamp";
import { WatchButton } from "@/components/WatchButton";
import { Delta } from "@/components/Delta";
import { getSession, sessionsAvailable } from "@/lib/auth/session";
import { can } from "@/lib/auth/entitlement";
import { activeProvider } from "@/lib/ask/provider";
import { freeAsksToShow } from "@/lib/ask/meter";
import { dateOnly, equityPrice } from "@/lib/format";
import { rsi } from "@/lib/ta/indicators";
import { getDict, PATHS } from "@/lib/i18n";
import { getBoard, getTimeframeBars, VN30 } from "@/lib/providers/vnstock";
import { HOSE_SYMBOLS, bandOf, exchangeOf } from "@/lib/universe";
import { foreignFlowAvailable, getForeignFlow } from "@/lib/providers/ssi";
import { getCorpEvents } from "@/lib/providers/events";
import { ChartSyncProvider } from "@/components/chart/ChartSync";
import { decodeTemplate } from "@/lib/chart/layouts";
import { chartSource, seriesKey } from "@/lib/chart/series";
import { dbAvailable, getDb } from "@/lib/db";
import type { Bar } from "@/lib/types";
import type { CompareSeries, RefLine } from "@/components/chart/chartShared";
import { DEFAULT_TF, timeframe } from "@/lib/chart/timeframes";
import { decodeView } from "@/lib/chart/view-state";
import { parseCompare } from "@/lib/chart/compare";
import { getBreadth } from "@/lib/providers/breadth";
import { alignBreadth } from "@/lib/breadth";
import { INDICATORS } from "@/lib/ta/registry";
import { TimeframePicker } from "@/components/chart/TimeframePicker";
import { Workspace } from "@/components/chart/tv/Workspace";
import type { PaneToggle } from "@/components/chart/tv/IndicatorsDialog";
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
/** A malformed escape is not a reason to fail the page; use it as typed. */
function safeDecode(v: string): string {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
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
  // Everything besides the bars depends only on the symbol, the tier and the
  // URL, so it is asked for alongside the bars instead of one feed after
  // another: each feed is a round trip to a Vietnamese API, and in series they
  // were most of this page's server time. Each settles to an empty value on
  // failure, so none can reject unobserved when the page returns early.
  // Multi-chart is Pro. A non-Pro request for a grid silently collapses to one
  // chart rather than erroring — the capability is upsold, not punished.
  const multi = can(tier, "chart:multi");
  const cells = multi ? Math.max(1, Math.min(layout, 4)) : 1;
  const companions = multi ? extra.slice(0, cells - 1) : [];
  const canCompare = can(tier, "chart:compare");
  // Capped by tier inside parseCompare, so a hand-typed ?cmp= with five symbols
  // cannot fan out into five upstream fetches.
  const compareSymbols = canCompare ? parseCompare(cmp, tier, sym) : [];
  // Foreign net buy/sell (khối ngoại) from SSI FastConnect — daily only, gated
  // to Plus, and only offered when the owner has wired SSI credentials.
  const foreignReady = foreignFlowAvailable();
  const companionBarsP = Promise.all(companions.map((sym2) => getTimeframeBars(sym2, view).catch(() => [] as Bar[])));
  // An index and a stock come from different endpoints; the only reliable way
  // to tell them apart here is that indices are not listed equities.
  const compareBarsP = Promise.all(compareSymbols.map((other) =>
    getTimeframeBars(other, view, { kind: exchangeOf(other) ? ("stock" as const) : ("index" as const) }).catch(() => [] as Bar[])));
  const foreignP = fr && canCompare && foreignReady && !view.intraday
    ? getForeignFlow(sym, 250).catch(() => [])
    : Promise.resolve([]);
  // Corporate events (cổ tức, phát hành) as x-axis markers. Free, and daily
  // only: an intraday window almost never contains an ex-date, so the fetch
  // would be noise. A chart without markers beats no chart.
  const eventsP = view.intraday ? Promise.resolve([]) : getCorpEvents(sym, locale).catch(() => []);
  const companionEventsP = view.intraday
    ? Promise.resolve(companions.map(() => []))
    : Promise.all(companions.map((c) => getCorpEvents(c, locale).catch(() => [])));
  // Market breadth — the Pro pane; daily only, see where it is drawn.
  const breadthP = br && multi && !view.intraday ? getBreadth().catch(() => []) : Promise.resolve([]);

  const [barsR, boardR] = await Promise.allSettled([
    source.kind === "recorded" ? recordedBars(source.code)
      : getTimeframeBars(sym, view),
    // The rail draws a glyph per row.
    getBoard(VN30, { spark: true }),
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

  const [companionBars, compareBars, flow, events, companionEvents, breadthPoints] =
    await Promise.all([companionBarsP, compareBarsP, foreignP, eventsP, companionEventsP, breadthP]);
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
  const compareSeries = compareSymbols.map((other, i) => {
    const other_bars = compareBars[i];
    if (!other_bars.length) return null;
    const byTs = new Map(other_bars.map((b) => [b.t, b.c]));
    return { label: other, series: bars.map((b) => byTs.get(b.t) ?? null) };
  });
  // A symbol whose feed failed is dropped rather than drawn as a gap that looks
  // like the stock stopped trading.
  const compare: CompareSeries[] = compareSeries.filter((c): c is CompareSeries => c !== null);

  // Foreign flow, aligned to the bars by trading DAY (sources keep different
  // epochs for the same day).
  let foreign: CompareSeries | null = null;
  /** Kept for the prose below, which must never trigger a fetch of its own. */
  let foreignDays: { date: string; netVal: number }[] = [];
  if (flow.length) {
    foreignDays = flow;
    const byDate = new Map(flow.map((f) => [f.date, f.netVal]));
    const isoDay = (t: number) =>
      new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(t * 1000));
    foreign = { label: dict.chart.foreignPane, series: bars.map((b) => byDate.get(isoDay(b.t)) ?? null) };
  }

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
  if (breadthPoints.length) {
    breadth = { label: dict.chart.breadthPane, series: alignBreadth(breadthPoints, bars) };
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

  const terminalBase = `/${locale}/${PATHS.terminal[locale]}/${sym}`;
  const tfQuery = `?tf=${encodeURIComponent(view.id)}`;
  const gridQuery = cells > 1 ? `&layout=${cells}&s=${companions.join(",")}` : "";
  const cmpQuery = compareSymbols.length ? `&cmp=${compareSymbols.join(",")}` : "";
  const pricing = (plan: string) => `/${locale}/${PATHS.pricing[locale]}?plan=${plan}`;
  const layoutDefaults = HOSE_SYMBOLS.filter((s) => s !== sym).slice(0, 3);
  const layoutHref = (n: number) => {
    if (n === 1) return `${terminalBase}${tfQuery}`;
    const picks = [...extra, ...layoutDefaults].filter((v, i, a) => a.indexOf(v) === i).slice(0, n - 1);
    return `${terminalBase}${tfQuery}&layout=${n}&s=${picks.join(",")}`;
  };
  // Breadth and foreign flow are panes the page switches on through the URL; the indicators dialog lists them.
  const panes: PaneToggle[] = [
    ...(!view.intraday ? [{
      id: "breadth", label: dict.chart.breadthPane, on: !!breadth,
      href: `${terminalBase}${tfQuery}${gridQuery}${cmpQuery}${foreign ? "&fr=1" : ""}${breadth ? "" : "&br=1"}`,
      ...(multi ? {} : { lockHref: pricing("pro") }),
    }] : []),
    ...(foreignReady && !view.intraday ? [{
      id: "foreign", label: dict.chart.foreignPane, on: !!foreign,
      href: `${terminalBase}${tfQuery}${gridQuery}${cmpQuery}${breadth ? "&br=1" : ""}${foreign ? "" : "&fr=1"}`,
      ...(canCompare ? {} : { lockHref: pricing("plus") }),
    }] : []),
  ];
  const exchange = exchangeOf(sym);

  return (
    <>
      {/* The 60 VN30 chart URLs are the biggest cohort in the sitemap and had no
          structured data at all. A trail, not a quote: the graph stays true
          whatever the market did, and the feed may lag. */}
      <JsonLd data={breadcrumbLd(siteUrl(), symbolTrail(locale, sym, dict.nav.home, dict.nav.stocks))} />
      <ChartViewed
        symbol={sym} tf={view.id} intraday={!!view.intraday} layout={cells}
        tier={tier} hasCmp={compare.length > 0} hasFr={!!foreign}
      />
      <h1 className="sr-only">{sym} — {dict.stocks.chartTitle}</h1>
      <Workspace
        dict={dict} symbol={sym}
        interval={
          <TimeframePicker key="interval" variant="menu" current={view.id} base={terminalBase} extraQuery={gridQuery}
            dict={dict} tier={tier} pricingHref={pricing("plus")} />
        }
        compare={{
          current: compareSymbols,
          base: `${terminalBase}${tfQuery}${gridQuery}${foreign ? "&fr=1" : ""}${breadth ? "&br=1" : ""}`,
          allowed: canCompare, lockHref: pricing("plus"),
          suggestions: ["VNINDEX", "VN30", ...HOSE_SYMBOLS].filter((s, i, a) => s !== sym && a.indexOf(s) === i),
        }}
        panes={panes}
        layouts={[1, 2, 4].map((n) => ({ n, href: n === 1 || multi ? layoutHref(n) : null }))}
        layout={cells} layoutLockHref={pricing("pro")} pricingHref={pricing("plus")}
        rangeLink={{ base: terminalBase, extraQuery: gridQuery }}
        panel={
          <>
            <section className="hidden border-b border-tv-border p-4 text-tv-text lg:block">
              <div className="flex items-center gap-2">
                <span className="text-[15px] font-semibold">{sym}</span>
                <WatchButton symbol={sym} addLabel={dict.stocks.addWatch} removeLabel={dict.stocks.removeWatch} />
              </div>
              {/* A recorded series says where its history STARTS: a chart that stops at the
                  left edge otherwise reads as missing data rather than as the beginning. */}
              <p className="mt-1 text-[12px] text-tv-text-2">
                {recorded
                  ? dict.chart.seriesFrom.replace("{d}", dateOnly(bars[0].t, locale))
                  : `${exchange ?? dict.common.noData} · ${dict.common.unit}: ${dict.common.thousandVnd}`}
              </p>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="tnum text-[26px] font-semibold leading-none">{equityPrice(last.c, locale)}</span>
                <span className="text-[14px]"><Delta change={change} changePct={changePct} locale={locale} /></span>
              </div>
              <div className="mt-2"><LiveStamp locale={locale} sessionAware /></div>
            </section>
            <ChartRail
              locale={locale} dict={dict} symbol={sym} board={board}
              current={last.c} previous={prev.c} tier={tier} isMock={activeProvider() === "mock"}
              initialTab={rail} indicators={rsi14}
              freeAsks={freeAsksToShow(tier, session?.asks, sessionsAvailable())}
            />
          </>
        }
      >
        {/* One provider around the whole grid: the cells share the hovered MOMENT,
            so a crosshair on one lands on the same session in every other. */}
        <ChartSyncProvider>
          <div className={`grid h-full ${cells === 2 ? "grid-cols-2" : cells === 4 ? "grid-cols-2 grid-rows-2" : ""}`}>
            <div data-chart-cell className="min-h-0 min-w-0">
              <TradingChart bars={bars} symbol={sym} locale={locale} dict={dict} tier={tier} digits={2} intraday={view.intraday}
                refLines={refLines} compare={compare} foreign={foreign} breadth={breadth} events={events} initialView={chartView}
                tf={view.id} exchange={exchange} role="primary" />
            </div>
            {companions.map((sym2, i) =>
              companionBars[i].length ? (
                <div key={sym2} data-chart-cell className="min-h-0 min-w-0 border-l border-t border-tv-border">
                  {/* Companions get their OWN ceiling/floor, from their own previous close and exchange band. */}
                  <TradingChart bars={companionBars[i]} symbol={sym2} locale={locale} dict={dict} tier={tier} digits={2}
                    intraday={view.intraday} refLines={companionRefs[i]} events={companionEvents[i]} tf={view.id}
                    exchange={exchangeOf(sym2)} role="cell" />
                </div>
              ) : (
                <div key={sym2} data-chart-cell className="border-l border-t border-tv-border p-5"><FeedBanner dict={dict} /></div>
              ),
            )}
          </div>
        </ChartSyncProvider>
      </Workspace>

      {/* Sixty VN30 chart URLs are the long-tail play; this is what a crawler reads.
          Equities only, and daily bars only: the canonical URL carries no timeframe. */}
      <div className="mx-auto max-w-[1400px] px-4 py-8 sm:px-6 lg:px-8">
        {source.kind === "equity" && !view.intraday && (
          <SymbolNarrative
            dict={dict}
            input={{
              symbol: sym,
              locale,
              bars,
              exchange,
              band,
              vn30: (VN30 as readonly string[]).includes(sym),
              ...(typeof rsiNow === "number" ? { rsi14: rsiNow } : {}),
              foreign: foreignDays,
              events,
            }}
          />
        )}
      </div>
    </>
  );
}
