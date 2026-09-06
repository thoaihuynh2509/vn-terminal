import Link from "next/link";
import { notFound } from "next/navigation";
import { Delta } from "@/components/Delta";
import { PriceChart } from "@/components/PriceChart";
import { Card } from "@/components/ui";
import { KeyValue, Panel, PageShell } from "@/components/layout";
import { FeedBanner } from "@/components/FeedBanner";
import { PageHeader } from "@/components/editorial";
import { compactUsd, usd } from "@/lib/format";
import { getDict, PATHS } from "@/lib/i18n";
import { getCoin, getCoinBars } from "@/lib/providers/crypto";
import { DEFAULT_SYMBOL } from "@/lib/providers/vnstock";
import type { Locale } from "@/lib/types";

export async function CoinDetail({ locale, id }: { locale: Locale; id: string }) {
  const dict = getDict(locale);

  const [coinR, barsR] = await Promise.allSettled([getCoin(id), getCoinBars(id, 90)]);

  // A rejected promise means the feed broke, not that the coin is unknown —
  // show the degraded state instead of claiming the asset does not exist.
  if (coinR.status === "rejected") {
    return (
      <>
        <PageHeader title={id} subtitle={dict.crypto.subtitle} />
        <FeedBanner dict={dict} detail={String(coinR.reason)} />
      </>
    );
  }
  if (coinR.value === null) notFound();
  const coin = coinR.value;
  const bars = barsR.status === "fulfilled" ? barsR.value : [];

  // Sub-dollar coins need more precision than the 2dp equity default.
  const digits = coin.price >= 1000 ? 0 : coin.price >= 1 ? 2 : 6;

  const rail = (
    <>
      <Panel>
        <KeyValue
          rows={[
            { k: dict.common.marketCap, v: compactUsd(coin.marketCap, locale) },
            { k: dict.crypto.volume24h, v: compactUsd(coin.volume24h, locale) },
            { k: dict.crypto.rank, v: `#${coin.rank}` },
          ]}
        />
      </Panel>
      <Link href={`/${locale}/${PATHS.terminal[locale]}/${DEFAULT_SYMBOL}?rail=ask`} className="card card-hover block bg-surface-2 p-3.5">
        <span className="text-[11px] font-bold uppercase tracking-wider text-accent">{dict.nav.ask}</span>
        <p className="mt-1 text-[13px] font-medium leading-snug">{dict.sidebar.askCta}</p>
      </Link>
    </>
  );

  return (
    <>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[24px] font-semibold tracking-tight">
            {coin.name} <span className="text-ink-2">{coin.symbol}</span>
          </h1>
          <p className="mt-1 text-[12px] text-muted">#{coin.rank} · {dict.common.marketCap} {compactUsd(coin.marketCap, locale)}</p>
        </div>
        <div className="text-right">
          <div className="text-[30px] font-semibold leading-none tracking-tight">{usd(coin.price, locale)}</div>
          <div className="mt-1.5 text-[13px]">
            <Delta change={coin.changePct24h} changePct={coin.changePct24h} locale={locale} showAbsolute={false} />
          </div>
        </div>
      </div>

      <PageShell rail={rail}>
        <Card className="p-4">
          <h2 className="mb-3 text-[15px] font-semibold tracking-tight">{dict.stocks.chartTitle}</h2>
          {/* market_chart is close-only, so volume bars would be a flat lie. */}
          <PriceChart bars={bars} locale={locale} dict={dict} digits={digits} showVolume={false} />
        </Card>
      </PageShell>
    </>
  );
}
