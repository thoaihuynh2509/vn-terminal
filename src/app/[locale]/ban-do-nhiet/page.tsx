import { HeatmapView } from "@/views/HeatmapView";
import { guard } from "@/views/guard";

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return <HeatmapView locale={guard(locale, "heatmap", "ban-do-nhiet")} />;
}
