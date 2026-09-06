import { permanentRedirect } from "next/navigation";
import { guard } from "@/views/guard";
import { href } from "@/lib/i18n";

/** The symbol page and the chart were the same page twice; the chart is the one that stays. */
export default async function Page({ params }: { params: Promise<{ locale: string; symbol: string }> }) {
  const { locale, symbol } = await params;
  const loc = guard(locale, "stocks", "stocks");
  permanentRedirect(href(loc, "terminal", `/${symbol.toUpperCase()}`));
}
