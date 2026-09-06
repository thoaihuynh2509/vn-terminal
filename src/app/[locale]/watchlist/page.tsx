import { redirect } from "next/navigation";
import { guard } from "@/views/guard";
import { href } from "@/lib/i18n";
import { DEFAULT_SYMBOL } from "@/lib/providers/vnstock";

/** The watchlist is a tab in the chart's rail now; the old URL opens that tab. */
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const loc = guard(locale, "watchlist", "watchlist");
  redirect(href(loc, "terminal", `/${DEFAULT_SYMBOL}?rail=watch`));
}
