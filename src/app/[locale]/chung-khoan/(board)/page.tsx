import { StocksBoard } from "@/views/StocksBoard";
import { guard } from "@/views/guard";
import { sectionMetadata } from "@/views/meta";
import { getDict } from "@/lib/i18n";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const locale = guard((await params).locale, "stocks", "chung-khoan");
  const d = getDict(locale).stocks;
  return sectionMetadata(locale, "stocks", { title: d.title, description: d.subtitle });
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return <StocksBoard locale={guard(locale, "stocks", "chung-khoan")} />;
}
