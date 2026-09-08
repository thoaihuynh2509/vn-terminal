import { GoldView } from "@/views/GoldView";
import { guard } from "@/views/guard";

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return <GoldView locale={guard(locale, "gold", "vang")} />;
}
