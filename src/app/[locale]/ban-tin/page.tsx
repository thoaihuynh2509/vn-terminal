import { BriefView } from "@/views/BriefView";
import { guard } from "@/views/guard";
import { sectionMetadata } from "@/views/meta";
import { getDict } from "@/lib/i18n";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const locale = guard((await params).locale, "brief", "ban-tin");
  const d = getDict(locale).brief;
  return sectionMetadata(locale, "brief", { title: d.title, description: d.subtitle });
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return <BriefView locale={guard(locale, "brief", "ban-tin")} />;
}
