import { TerminalView } from "@/views/TerminalView";
import { guard } from "@/views/guard";

export const revalidate = 60;

export async function generateMetadata({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  return { title: `${symbol.toUpperCase()} — Chart` };
}

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; symbol: string }>;
  searchParams: Promise<{
    layout?: string; s?: string; tf?: string; rail?: string; cmp?: string; fr?: string; br?: string;
    /** The view a shared link carries: chart type, indicators, visible range. */
    type?: string; ind?: string; r?: string;
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
      view={{ type: sp.type, ind: sp.ind, r: sp.r }} />
  );
}
