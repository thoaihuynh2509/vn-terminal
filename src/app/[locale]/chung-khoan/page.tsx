import { StocksBoard } from "@/views/StocksBoard";
import { guard } from "@/views/guard";

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return <StocksBoard locale={guard(locale, "stocks", "chung-khoan")} />;
}
