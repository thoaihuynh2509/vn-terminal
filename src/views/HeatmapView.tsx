import { FeedBanner } from "@/components/FeedBanner";
import { Heatmap, HeatmapLegend } from "@/components/Heatmap";
import { Stack } from "@/components/layout";
import { PageHeader } from "@/components/editorial";
import { getDict } from "@/lib/i18n";
import { getBoard } from "@/lib/providers/vnstock";
import type { Locale } from "@/lib/types";

export async function HeatmapView({ locale }: { locale: Locale }) {
  const dict = getDict(locale);
  let quotes = null;
  let error: string | undefined;
  try {
    quotes = await getBoard();
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  return (
    <>
      <PageHeader title={dict.heatmap.title} subtitle={dict.heatmap.subtitle} />

      {quotes?.length ? (
        <Stack gap="md">
          <div>
            <Heatmap quotes={quotes} locale={locale} height={460} max={30} />
            <HeatmapLegend
              labels={{ down: dict.heatmap.legendDown, flat: dict.heatmap.legendFlat, up: dict.heatmap.legendUp }}
            />
          </div>
          <p className="max-w-[68ch] text-[13px] leading-relaxed text-ink-2">{dict.heatmap.note}</p>
        </Stack>
      ) : (
        <FeedBanner dict={dict} detail={error} />
      )}
    </>
  );
}
