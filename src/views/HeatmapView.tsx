import { FeedBanner } from "@/components/FeedBanner";
import { Heatmap, HeatmapLegend } from "@/components/Heatmap";
import { SectorBars } from "@/components/SectorBars";
import { Stack, Panel } from "@/components/layout";
import { PageHeader } from "@/components/editorial";
import { DarkPanel } from "@/components/ui";
import { LiveStamp } from "@/components/LiveStamp";
import { volume } from "@/lib/format";
import { getDict, PATHS } from "@/lib/i18n";
import { getBoard } from "@/lib/providers/vnstock";
import type { Locale, Quote } from "@/lib/types";

/** Where the money went: the biggest tiles on the map, by traded value. */
function turnoverLeaders(board: Quote[], n: number): Quote[] {
  return [...board]
    .sort((a, b) => (b.volume ?? 0) * b.price - (a.volume ?? 0) * a.price)
    .slice(0, n);
}

export async function HeatmapView({ locale }: { locale: Locale }) {
  const dict = getDict(locale);
  let quotes = null;
  let error: string | undefined;
  try {
    quotes = await getBoard();
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  const leaders = quotes?.length ? turnoverLeaders(quotes, 3) : [];

  return (
    <>
      <PageHeader
        title={dict.heatmap.title}
        subtitle={dict.heatmap.subtitle}
        action={quotes?.length ? <LiveStamp locale={locale} /> : undefined}
      />

      {quotes?.length ? (
        <Stack gap="md">
          <div>
            <Heatmap quotes={quotes} locale={locale} height={520} max={30} />
            <HeatmapLegend
              labels={{ down: dict.heatmap.legendDown, flat: dict.heatmap.legendFlat, up: dict.heatmap.legendUp }}
            />
          </div>

          <div className="grid gap-5 lg:grid-cols-3">
            <Panel title={dict.home.movers}>
              <ul className="flex flex-col gap-3">
                {leaders.map((q) => (
                  <li key={q.symbol} className="flex items-baseline justify-between gap-3 font-mono text-[14px]">
                    <span className="font-medium">{q.symbol}</span>
                    <span className="tnum text-muted">{q.volume ? volume(q.volume, locale) : "—"}</span>
                  </li>
                ))}
              </ul>
            </Panel>

            <Panel title={dict.home.rotation}>
              <SectorBars board={quotes} locale={locale} dict={dict} />
            </Panel>

            <DarkPanel
              eyebrow={dict.pricing.pro}
              title={dict.pricing.fWatchlist}
              body={dict.heatmap.note}
              cta={dict.pricing.upgrade}
              href={`/${locale}/${PATHS.pricing[locale]}`}
            />
          </div>

          <p className="max-w-[68ch] text-[14px] leading-relaxed text-ink-2">{dict.heatmap.note}</p>
        </Stack>
      ) : (
        <FeedBanner dict={dict} detail={error} />
      )}
    </>
  );
}
