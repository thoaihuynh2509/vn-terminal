import { PricingView } from "@/views/PricingView";
import { guard } from "@/views/guard";

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return <PricingView locale={guard(locale, "pricing", "goi-dich-vu")} />;
}
