import { BriefView } from "@/views/BriefView";
import { guard } from "@/views/guard";

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return <BriefView locale={guard(locale, "brief", "market-brief")} />;
}
