import { HeatmapView } from "@/views/HeatmapView";
import { guard } from "@/views/guard";

export const revalidate = 60;

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return <HeatmapView locale={guard(locale, "heatmap", "market-heatmap")} />;
}
