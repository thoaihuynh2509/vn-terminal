import { FeedBanner } from "@/components/FeedBanner";
import { JsonLd } from "@/components/JsonLd";
import { QuoteTable } from "@/components/QuoteTable";
import { Explainer } from "@/components/Explainer";
import { BreadthBar } from "@/components/BreadthBar";
import { LiveStamp } from "@/components/LiveStamp";
import { SectorBars } from "@/components/SectorBars";
import { PageHeader } from "@/components/editorial";
import { SectionHead } from "@/components/chrome";
import { Card, DarkPanel, UpgradeBand } from "@/components/ui";
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
        action={
          quotes?.length ? (
            /* Breadth reads as a figure and a bar side by side, so the header
               answers "what kind of session is this" before the table loads. */
            <div className="flex items-end gap-6">
              <div className="text-right">
                <div className="font-mono text-[11px] uppercase tracking-[0.1em] text-muted">{dict.home.breadth}</div>
                <div className="tnum mt-1.5 font-mono text-[15px]">
                  <span className="text-up">{advancing} {dict.common.up}</span>
                  <span className="text-muted"> / </span>
                  <span className="text-down">{declining} {dict.common.down}</span>
                </div>
              </div>
              <div className="w-[180px] pb-2">
                <BreadthBar
                  up={advancing} down={declining} flat={unchanged}
                  labels={{ up: dict.common.up, down: dict.common.down, flat: dict.common.flat }}
                  showCounts={false}
                />
              </div>
            </div>
          ) : undefined
        }
      />

      {quotes?.length ? (
        <Stack gap="lg">
          <div>
            <div className="mb-3 flex justify-end">
              <LiveStamp locale={locale} />
            </div>
            <QuoteTable quotes={quotes} locale={locale} dict={dict} band={BAND.HOSE} sectors />
          </div>

          {/* The board is complete and free. What is gated is what runs after
              the reader closes the tab — say that, rather than greying out a
              column of numbers we do not actually have. */}
          <UpgradeBand
            eyebrow={dict.pricing.plus}
            title={dict.pricing.fAlertEmail}
            body={dict.pricing.subtitle}
            cta={dict.pricing.cta}
            href={`/${locale}/${PATHS.pricing[locale]}`}
          />

          <div className="grid gap-5 lg:grid-cols-2">
            <section>
              <SectionHead title={dict.home.rotation} subtitle={dict.home.rotationHint} />
              <Card className="p-5"><SectorBars board={quotes} locale={locale} dict={dict} /></Card>
            </section>
            <DarkPanel
              eyebrow={dict.pricing.pro}
              title={dict.pricing.proDesc}
              body={dict.pricing.subtitle}
              cta={dict.pricing.upgrade}
              href={`/${locale}/${PATHS.pricing[locale]}`}
              className="self-start"
            />
          </div>

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
