import Link from "next/link";
import { notFound } from "next/navigation";
import { ChartPro } from "@/components/chart/ChartPro";
import { ChartRail } from "@/components/chart/ChartRail";
import { PageHeader } from "@/components/editorial";
import { FeedBanner } from "@/components/FeedBanner";
import { PageShell } from "@/components/layout";
import { SymbolSearchButton } from "@/components/SymbolSearch";
import { WatchButton } from "@/components/WatchButton";
import { Delta } from "@/components/Delta";
import { getSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/entitlement";
import { activeProvider } from "@/lib/ask/provider";
import { equityPrice } from "@/lib/format";
import { getDict, PATHS, type Dict } from "@/lib/i18n";
import { getBoard, getTimeframeBars, VN30 } from "@/lib/providers/vnstock";
import { DEFAULT_TF, timeframe } from "@/lib/chart/timeframes";
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
  locale, symbol, extra = [], layout = 1, tf, rail,
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

  return (
    <PageShell
      rail={
        <ChartRail
          locale={locale} dict={dict} symbol={sym} board={board}
          current={last.c} previous={prev.c} tier={tier} isMock={activeProvider() === "mock"}
          initialTab={rail}
        />
      }
    >
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-[26px] font-semibold tracking-tight">{sym}</h1>
            <WatchButton symbol={sym} addLabel={dict.stocks.addWatch} removeLabel={dict.stocks.removeWatch} />
            <SymbolSearchButton label={dict.chart.changeSymbol} compact />
          </div>
          <p className="mt-0.5 text-[12px] text-muted">HOSE · {dict.common.unit}: {dict.common.thousandVnd}</p>
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
      </div>

      <div className={`grid gap-4 ${cells > 1 ? "xl:grid-cols-2" : ""}`}>
        <div className="card min-w-0 p-4">
          <ChartPro bars={bars} symbol={sym} locale={locale} dict={dict} tier={tier} digits={2} intraday={view.intraday} />
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
