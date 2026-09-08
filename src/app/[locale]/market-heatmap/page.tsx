import { HeatmapView } from "@/views/HeatmapView";
import { guard } from "@/views/guard";
import { sectionMetadata } from "@/views/meta";
import { getDict } from "@/lib/i18n";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const locale = guard((await params).locale, "heatmap", "market-heatmap");
  const d = getDict(locale).heatmap;
  return sectionMetadata(locale, "heatmap", { title: d.title, description: d.subtitle });
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return <HeatmapView locale={guard(locale, "heatmap", "market-heatmap")} />;
}
