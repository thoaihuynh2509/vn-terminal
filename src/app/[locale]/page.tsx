import Link from "next/link";
import { notFound } from "next/navigation";
import { AskBox } from "@/components/AskBox";
import { BreadthBar } from "@/components/BreadthBar";
import { Delta } from "@/components/Delta";
import { LiveStamp } from "@/components/LiveStamp";
import { OnboardingWatchlist } from "@/components/OnboardingWatchlist";
import { FeedBanner } from "@/components/FeedBanner";
import { Heatmap, HeatmapLegend } from "@/components/Heatmap";
import { QuoteTable } from "@/components/QuoteTable";
import { ReadAloud } from "@/components/ReadAloud";
import { SectorBars } from "@/components/SectorBars";
import { Sparkline } from "@/components/Sparkline";
import { SectionHead } from "@/components/chrome";
import { PageHeader } from "@/components/editorial";
import { Card } from "@/components/ui";
import { getSession, sessionsAvailable } from "@/lib/auth/session";
import { dbAvailable, getDb } from "@/lib/db";
import { activeProvider } from "@/lib/ask/provider";
import { freeAsksToShow } from "@/lib/ask/meter";
import { buildBrief } from "@/lib/brief";
import { dirOf, equityPrice, num, pct } from "@/lib/format";
import { getDict, href, isLocale, PATHS } from "@/lib/i18n";
import { getCoins } from "@/lib/providers/crypto";
import { cryptoEnabled } from "@/lib/flags";
import { getGold, headlineRow, premium } from "@/lib/providers/gold";
import { getBoard, getIndexSparks, getIndices } from "@/lib/providers/vnstock";
import type { Locale, Quote } from "@/lib/types";

const USD_VND = Number(process.env.NEXT_PUBLIC_USD_VND ?? 26_300);

function topMovers(board: Quote[], n: number) {
  const sorted = [...board].sort((a, b) => b.changePct - a.changePct);
  return { gainers: sorted.slice(0, n), losers: sorted.slice(-n).reverse() };
}

/**
 * The landing.
 *
 * It opens on a market READ, not a menu: a one-line verdict, then one tile each
 * for the three asset classes the product is about — equities, gold, crypto —
 * so a visitor knows in a glance what today is. The AI box sits high because it
 * is the thing no other VN finance site has; the sign-in nudge turns a reader
 * into an account, which is what brings them back.
 */
export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const dict = getDict(locale);
  const viewAll = dict.common.viewAll;
  const session = await getSession();

  const [indicesR, boardR, goldR, coinsR] = await Promise.allSettled([
    getIndices(), getBoard(), getGold(), cryptoEnabled() ? getCoins(20) : Promise.resolve([]),
  ]);
  const indices = indicesR.status === "fulfilled" ? indicesR.value : [];
  const board = boardR.status === "fulfilled" ? boardR.value : [];
  const gold = goldR.status === "fulfilled" ? goldR.value : null;
  const coins = coinsR.status === "fulfilled" ? coinsR.value : [];
  const { gainers, losers } = topMovers(board, 5);

  const sparks = indices.length
    ? await getIndexSparks(indices.map((i) => i.symbol)).catch(() => ({} as Record<string, number[]>))
    : {};

  const goldTop = gold ? headlineRow(gold.rows) : undefined;
  const prem = gold?.world && goldTop ? premium(gold.world.buy, goldTop.sell, USD_VND) : null;
  const brief = buildBrief(locale, { indices, board, gold, goldHeadline: goldTop, coins, premiumPct: prem?.pct });

  const vnindex = indices.find((i) => i.symbol === "VNINDEX") ?? indices[0];
  const btc = coins.find((c) => c.symbol === "BTC") ?? coins[0];
  const up = board.filter((q) => q.changePct > 0).length;
  const down = board.filter((q) => q.changePct < 0).length;
  const flat = Math.max(0, board.length - up - down);
  const pulse = !vnindex
    ? null
    : vnindex.changePct > 0 ? dict.home.pulseUp : vnindex.changePct < 0 ? dict.home.pulseDown : dict.home.pulseFlat;

  // Signed-in personalisation: the reader's own watchlist, biggest movers first.
  let watch: Quote[] = [];
  if (session?.email && dbAvailable()) {
    try {
      const db = await getDb();
      const user = await db.users.findByEmail(session.email);
      const syms = user ? await db.watchlist.list(user.id) : [];
      if (syms.length) {
        const wq = await getBoard(syms).catch(() => [] as Quote[]);
        watch = [...wq].sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct)).slice(0, 6);
      }
    } catch {
      /* watchlist is a nicety on the landing; never let it break the page */
    }
  }

  const dateLabel = new Intl.DateTimeFormat(locale === "vi" ? "vi-VN" : "en-US", {
    weekday: "long", day: "2-digit", month: "long", timeZone: "Asia/Ho_Chi_Minh",
  }).format(new Date());

  return (
    <>
      <PageHeader title={dict.home.today} meta={dateLabel} />

      {/* The verdict + a live stamp, then the mood bar: what today is, at a glance. */}
      {board.length > 0 && (
        <div className="-mt-2 mb-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            {pulse && <span className="text-[15px] font-semibold text-ink">{pulse}</span>}
            <LiveStamp locale={locale} />
          </div>
          <BreadthBar up={up} down={down} flat={flat} labels={{ up: dict.home.pulseAdv, down: dict.home.pulseDec, flat: dict.common.flat }} />
        </div>
      )}

      {/* Cross-asset hero — equities, gold, crypto in one glance. */}
      {(vnindex || goldTop || btc) && (
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          {vnindex && (
            <HeroTile
              label="VN-Index" href={`/${locale}/${PATHS.stocks[locale]}`}
              value={num(vnindex.price, locale, 2)}
              delta={<Delta change={vnindex.change} changePct={vnindex.changePct} locale={locale} />}
              spark={sparks[vnindex.symbol] ?? vnindex.spark} sparkDir={dirOf(vnindex.changePct, 2)}
            />
          )}
          {goldTop && (
            <HeroTile
              label={dict.home.heroGold} href={`/${locale}/${PATHS.gold[locale]}`}
              value={equityPrice(goldTop.sell, locale)}
              delta={<Delta change={goldTop.changeSell} locale={locale} />}
              note={prem ? `${pct(prem.pct, locale)} ${dict.gold.vsWorld}` : undefined}
            />
          )}
          {btc && (
            <HeroTile
              label={dict.home.heroBtc} href={`/${locale}/${PATHS.crypto[locale]}`}
              value={`${num(btc.price, locale, 0)} $`}
              delta={<Delta change={btc.changePct24h} changePct={btc.changePct24h} showAbsolute={false} locale={locale} />}
              spark={btc.sparkline} sparkDir={dirOf(btc.changePct24h, 2)}
            />
          )}
        </div>
      )}

      {/* First-visit activation: pick a few symbols → the watchlist loop starts now. */}
      <OnboardingWatchlist dict={dict} locale={locale as Locale} />

      {/* Signed-in personalisation, up top: the reader's own board comes first. */}
      {watch.length > 0 && (
        <section className="mb-4">
          <SectionHead title={dict.home.yourWatch} href={`/${locale}/${PATHS.watchlist[locale]}`} viewAll={viewAll} />
          <QuoteTable quotes={watch} locale={locale} dict={dict} showWatch={false} compact />
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Left: the visual board and the movers, so the tall column carries the data. */}
        <div className="space-y-4 lg:col-span-2">
          <section>
            <SectionHead title={dict.heatmap.title} href={`/${locale}/${PATHS.heatmap[locale]}`} viewAll={viewAll} />
            {board.length ? (
              <>
                <Heatmap quotes={board} locale={locale} height={340} />
                <HeatmapLegend labels={{ down: dict.heatmap.legendDown, flat: dict.heatmap.legendFlat, up: dict.heatmap.legendUp }} />
              </>
            ) : (
              <FeedBanner dict={dict} detail={boardR.status === "rejected" ? String(boardR.reason) : undefined} />
            )}
          </section>

          <div className="grid gap-4 sm:grid-cols-2">
            <section>
              <SectionHead title={dict.home.gainers} href={`/${locale}/${PATHS.stocks[locale]}`} viewAll={viewAll} />
              {board.length ? <QuoteTable quotes={gainers} locale={locale} dict={dict} showWatch={false} compact /> : <FeedBanner dict={dict} />}
            </section>
            <section>
              <SectionHead title={dict.home.losers} href={`/${locale}/${PATHS.stocks[locale]}`} viewAll={viewAll} />
              {board.length ? <QuoteTable quotes={losers} locale={locale} dict={dict} showWatch={false} compact /> : <FeedBanner dict={dict} />}
            </section>
          </div>
        </div>

        {/* Right rail: the differentiator first, then the reads that fill the column. */}
        <div className="space-y-4">
          <section>
            <SectionHead title={dict.home.askTitle} />
            <Card className="p-3.5">
              <p className="mb-2.5 text-[12px] leading-relaxed text-muted">{dict.home.askSub}</p>
              <AskBox locale={locale} isMock={activeProvider() === "mock"} tier={session?.tier ?? "anon"}
                freeAsks={freeAsksToShow(session?.tier ?? "anon", session?.asks, sessionsAvailable())} compact />
            </Card>
          </section>

          <section>
            <SectionHead title={dict.brief.title} href={`/${locale}/${PATHS.brief[locale]}`} viewAll={viewAll} />
            {brief.paragraphs.length ? (
              <Card className="p-3.5">
                <h3 className="text-[16px] font-semibold leading-snug">{brief.headline}</h3>
                <p className="mt-2 text-[13px] leading-relaxed text-ink-2">{brief.standfirst}</p>
                <div className="mt-3"><ReadAloud text={[brief.headline, brief.standfirst].join(". ")} dict={dict} locale={locale} /></div>
                <Link href={`/${locale}/${PATHS.brief[locale]}`} className="mt-3 inline-block text-[12px] font-medium text-accent hover:underline">
                  {dict.brief.title} →
                </Link>
              </Card>
            ) : (
              <FeedBanner dict={dict} />
            )}
          </section>

          <section>
            <SectionHead title={dict.home.rotation} href={`/${locale}/${PATHS.stocks[locale]}`} viewAll={viewAll}>
              <span className="ml-2 hidden text-[11px] normal-case text-muted xl:inline">{dict.home.rotationHint}</span>
            </SectionHead>
            {board.length ? (
              <Card className="p-3.5"><SectorBars board={board} locale={locale} dict={dict} /></Card>
            ) : (
              <FeedBanner dict={dict} />
            )}
          </section>
        </div>
      </div>

      {/* Reader → account: the loop that brings people back. */}
      <RetentionNudge locale={locale} dict={dict} signedIn={!!session?.email} />
    </>
  );
}

/** A cross-asset hero tile: label, big value, direction, and shape context. */
function HeroTile({ label, href: to, value, delta, spark, sparkDir, note }: {
  label: string; href: string; value: string; delta: React.ReactNode;
  spark?: number[]; sparkDir?: "up" | "down" | "flat"; note?: string;
}) {
  return (
    <Link href={to} className="card card-hover flex flex-col p-4">
      <span className="text-[11px] font-bold uppercase tracking-wider text-muted">{label}</span>
      <div className="mt-2 flex items-end justify-between gap-2">
        <span className="tnum text-[28px] font-semibold leading-none tracking-tight">{value}</span>
        {spark && spark.length > 2 && (
          <span className="shrink-0 pb-0.5"><Sparkline points={spark} dir={sparkDir ?? "flat"} width={72} height={26} /></span>
        )}
      </div>
      <div className="mt-2 text-[13px]">{delta}</div>
      {note && <div className="mt-1 tnum text-[12px] text-muted">{note}</div>}
    </Link>
  );
}

/** Sign-in / account nudge. Signed in, it points at the watchlist instead. */
function RetentionNudge({ locale, dict, signedIn }: { locale: Locale; dict: ReturnType<typeof getDict>; signedIn: boolean }) {
  return (
    <Card className="mt-4 flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h2 className="text-[16px] font-semibold tracking-tight">{signedIn ? dict.home.yourWatch : dict.home.saveTitle}</h2>
        <p className="mt-1 max-w-[64ch] text-[13px] leading-relaxed text-ink-2">{dict.home.saveBody}</p>
      </div>
      <div className="flex shrink-0 gap-2">
        <Link
          href={signedIn ? `/${locale}/${PATHS.watchlist[locale]}` : `${href(locale, "login")}?next=${encodeURIComponent(`/${locale}/${PATHS.watchlist[locale]}`)}`}
          className="rounded border border-accent bg-accent px-3.5 py-2 text-center text-[13px] font-semibold text-page hover:opacity-90"
        >
          {signedIn ? dict.home.yourWatch : dict.home.saveCta}
        </Link>
        <Link href={`/${locale}/${PATHS.pricing[locale]}`} className="rounded border border-line bg-surface-2 px-3.5 py-2 text-center text-[13px] font-medium text-ink hover:bg-surface">
          {dict.home.saveCta2}
        </Link>
      </div>
    </Card>
  );
}
