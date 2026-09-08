import { GoldView } from "@/views/GoldView";
import { guard } from "@/views/guard";
import { sectionMetadata } from "@/views/meta";
import { getDict } from "@/lib/i18n";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const locale = guard((await params).locale, "gold", "gold");
  const d = getDict(locale).gold;
  return sectionMetadata(locale, "gold", { title: d.title, description: d.subtitle });
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return <GoldView locale={guard(locale, "gold", "gold")} />;
}
