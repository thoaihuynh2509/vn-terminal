import { FeedBanner } from "@/components/FeedBanner";
import { Heatmap } from "@/components/Heatmap";
import { JsonLd } from "@/components/JsonLd";
import { SectorBars } from "@/components/SectorBars";
import { Sparkline } from "@/components/Sparkline";
import { Card } from "@/components/ui";
import { buildBrief } from "@/lib/brief";
import { getDict } from "@/lib/i18n";
import { ReadAloud } from "@/components/ReadAloud";
import { getCoins } from "@/lib/providers/crypto";
import { getGold, headlineRow, premium } from "@/lib/providers/gold";
import { getBoard, getIndexSparks, getIndices } from "@/lib/providers/vnstock";
import { dirOf } from "@/lib/format";
import type { BriefSection } from "@/lib/brief";
import type { Locale } from "@/lib/types";

const USD_VND = Number(process.env.NEXT_PUBLIC_USD_VND ?? 26_300);

export async function BriefView({ locale }: { locale: Locale }) {
  const dict = getDict(locale);

  const [indicesR, boardR, goldR, coinsR] = await Promise.allSettled([
    getIndices(),
    getBoard(),
    getGold(),
    getCoins(20),
  ]);
  const indices = indicesR.status === "fulfilled" ? indicesR.value : [];
  const board = boardR.status === "fulfilled" ? boardR.value : [];
  const gold = goldR.status === "fulfilled" ? goldR.value : null;
  const coins = coinsR.status === "fulfilled" ? coinsR.value : [];

  // One extra request, only for the sparkline on the indices card.
  const sparks = indices.length
    ? await getIndexSparks(indices.map((i) => i.symbol)).catch(() => ({} as Record<string, number[]>))
    : {};

  const top = gold ? headlineRow(gold.rows) : undefined;
  const premiumPct =
    gold?.world && top ? premium(gold.world.buy, top.sell, USD_VND).pct : undefined;

  const brief = buildBrief(locale, { indices, board, gold, goldHeadline: top, coins, premiumPct });
  const now = new Date();
  const dateLabel = new Intl.DateTimeFormat(locale === "vi" ? "vi-VN" : "en-US", {
    weekday: "long", day: "2-digit", month: "long", year: "numeric",
    hour: "2-digit", minute: "2-digit", timeZone: "Asia/Ho_Chi_Minh",
  }).format(now);

  const vnindex = indices.find((i) => i.symbol === "VNINDEX");
  const btc = coins.find((c) => c.symbol === "BTC");

  /** Chart for a section, or nothing where we hold no series (gold, flow). */
  function visual(id: BriefSection) {
    if (id === "indices" && vnindex) {
      const points = sparks[vnindex.symbol] ?? vnindex.spark ?? [];
      if (points.length < 3) return null;
      return (
        <div className="mt-3">
          <Sparkline points={points} dir={dirOf(vnindex.changePct, 2)} width={260} height={44} />
        </div>
      );
    }
    if (id === "breadth" && board.length) {
      return (
        <div className="mt-3">
          <Heatmap quotes={board} locale={locale} height={140} max={12} />
        </div>
      );
    }
    if (id === "rotation" && board.length) {
      return (
        <div className="mt-3">
          <SectorBars board={board} locale={locale} dict={dict} />
        </div>
      );
    }
    if (id === "crypto" && btc?.sparkline && btc.sparkline.length > 2) {
      return (
        <div className="mt-3">
          <Sparkline points={btc.sparkline} dir={dirOf(btc.changePct24h, 2)} width={260} height={44} />
        </div>
      );
    }
    return null;
  }

  if (!brief.paragraphs.length) {
    return (
      <>
        <h1 className="text-[20px] font-semibold tracking-tight">{dict.brief.title}</h1>
        <p className="mb-5 mt-1 text-[13px] text-muted">{dict.brief.subtitle}</p>
        <FeedBanner dict={dict} />
      </>
    );
  }

  return (
    <>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "NewsArticle",
          headline: brief.headline,
          datePublished: now.toISOString(),
          dateModified: now.toISOString(),
          inLanguage: locale === "vi" ? "vi-VN" : "en-US",
          description: brief.standfirst,
          author: { "@type": "Organization", name: dict.brand },
          publisher: { "@type": "Organization", name: dict.brand },
        }}
      />

      <article>
        <p className="text-[11px] font-bold uppercase tracking-wider text-muted">
          {dict.brief.title} · {dateLabel}
        </p>
        {/* Sans, not a serif: this is a data read-out, and the 38px display
            headline read as a different site from every other page. */}
        <h1 className="mt-2 max-w-[34ch] text-[28px] font-semibold leading-tight tracking-tight">
          {brief.headline}
        </h1>
        <p className="mt-4 max-w-[68ch] text-[14px] leading-relaxed text-ink-2">{brief.standfirst}</p>

        {/* Reads our own composed brief — no third-party text is ever spoken. */}
        <div className="mt-4">
          <ReadAloud
            text={[brief.headline, brief.standfirst, ...brief.paragraphs.flatMap((p) => p.sentences)].join(". ")}
            dict={dict}
            locale={locale}
          />
        </div>

        <div className="mt-8 grid gap-5 sm:grid-cols-2">
          {brief.paragraphs.map((p) => (
            <Card key={p.id} className="p-4">
              <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted">{p.heading}</h2>
              {/* The figure the paragraph is describing, drawn from the same data.
                  A card that only has sentences about a shape should show the shape. */}
              {visual(p.id)}
              <div className="mt-2 space-y-2">
                {p.sentences.map((s, i) => (
                  <p key={i} className="max-w-[68ch] text-[14px] leading-relaxed">{s}</p>
                ))}
              </div>
            </Card>
          ))}
        </div>

        <p className="mt-8 max-w-[68ch] text-[12px] leading-relaxed text-muted">
          {dict.brief.method}
        </p>
      </article>
    </>
  );
}
