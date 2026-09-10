import { FeedBanner } from "@/components/FeedBanner";
import { JsonLd } from "@/components/JsonLd";
import { QuoteTable } from "@/components/QuoteTable";
import { Explainer } from "@/components/Explainer";
import { BreadthBar } from "@/components/BreadthBar";
import { LiveStamp } from "@/components/LiveStamp";
import { PageHeader } from "@/components/editorial";
import { Card } from "@/components/ui";
import { Stack } from "@/components/layout";
import { getExplainer } from "@/content/explainers";
import { dirOf } from "@/lib/format";
import { getDict, PATHS } from "@/lib/i18n";
import { itemListLd } from "@/lib/seo";
import { siteUrl } from "@/lib/site";
import { BAND, getBoard } from "@/lib/providers/vnstock";
import type { Locale } from "@/lib/types";

export async function StocksBoard({ locale }: { locale: Locale }) {
  const dict = getDict(locale);
  let quotes = null;
  let error: string | undefined;
  try {
    quotes = await getBoard();
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  // Breadth uses the same rounding as the row-level glyph (Delta/QuoteTable)
  // so a stock that displays as flat is never counted as an advancer.
  const advancing = quotes?.filter((q) => dirOf(q.change) === "up").length ?? 0;
  const declining = quotes?.filter((q) => dirOf(q.change) === "down").length ?? 0;
  const unchanged = quotes ? quotes.length - advancing - declining : 0;

  return (
    <>
      <PageHeader
        title={dict.stocks.title}
        subtitle={dict.stocks.subtitle}
        meta={`${dict.common.unit}: ${dict.common.thousandVnd} · ${dict.stocks.band} HOSE ±7%`}
      />

      {quotes?.length ? (
        <Stack gap="md">
          <Card className="p-3.5">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-muted">{dict.stocks.title}</span>
              <LiveStamp locale={locale} />
            </div>
            <BreadthBar up={advancing} down={declining} flat={unchanged} labels={{ up: dict.common.up, down: dict.common.down, flat: dict.common.flat }} />
          </Card>
          <QuoteTable quotes={quotes} locale={locale} dict={dict} band={BAND.HOSE} sectors />
          {/* The same thirty destinations the table shows, stated as a list. */}
          <JsonLd
            data={itemListLd(
              siteUrl(),
              quotes.map((q) => ({
                name: `${q.symbol} — ${dict.stocks.chartOf}`,
                path: `/${locale}/${PATHS.terminal[locale]}/${q.symbol}`,
              })),
            )}
          />
        </Stack>
      ) : (
        <FeedBanner dict={dict} detail={error} />
      )}
      <Explainer content={getExplainer("stocks", locale)} />
    </>
  );
}
