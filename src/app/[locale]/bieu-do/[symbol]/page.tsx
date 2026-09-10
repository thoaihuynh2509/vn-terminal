import { TerminalView } from "@/views/TerminalView";
import { guard } from "@/views/guard";
import { sectionMetadata } from "@/views/meta";
import { getDict } from "@/lib/i18n";
import { quoteDescription } from "@/lib/seo/narrative";
import { getBoard } from "@/lib/providers/vnstock";
import { exchangeOf } from "@/lib/universe";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; symbol: string }>;
}) {
  const { locale: raw, symbol } = await params;
  const locale = guard(raw, "terminal", "bieu-do");
  const sym = symbol.toUpperCase();
  const d = getDict(locale).chart;
  // These 60 VN30 URLs are the largest cohort in the sitemap, and until now
  // every one of them inherited the layout's `/{locale}` canonical — telling
  // Google each chart was a duplicate of the home page. The title was also
  // hardcoded English on the Vietnamese route.
  //
  // The description now names the symbol's own price. `getBoard()` is the same
  // cached call the page itself makes, so this costs a cache read, not a fetch;
  // when it fails the generic subtitle still describes the page correctly.
  const quote = (await getBoard().catch(() => []))?.find((q) => q.symbol === sym);
  const description =
    quoteDescription(quote, { symbol: sym, locale, exchange: exchangeOf(sym) })
    ?? `${sym} · ${d.subtitle}`;
  return sectionMetadata(locale, "terminal", { title: `${sym} — ${d.title}`, description }, `/${sym}`);
}

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; symbol: string }>;
  searchParams: Promise<{
    layout?: string; s?: string; tf?: string; rail?: string; cmp?: string; fr?: string; br?: string;
    /** The view a shared link carries: chart type, indicators, visible range. */
    type?: string; ind?: string; r?: string; sc?: string;
    /** A setup packed into the link (P3-4). Opens read-only; saving needs a slot. */
    tpl?: string;
  }>;
}) {
  const { locale, symbol } = await params;
  const sp = await searchParams;
  const n = Number(sp.layout);
  const layout = n === 2 || n === 4 ? (n as 2 | 4) : 1;
  const extra = (sp.s ?? "")
    .split(",")
    .map((v) => v.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 3);
  return (
    <TerminalView locale={guard(locale, "terminal", "bieu-do")} symbol={symbol} extra={extra} layout={layout} tf={sp.tf} rail={sp.rail} cmp={sp.cmp} fr={sp.fr === "1"} br={sp.br === "1"}
      view={{ type: sp.type, ind: sp.ind, r: sp.r, sc: sp.sc }} tpl={sp.tpl} />
  );
}
