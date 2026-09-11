import Link from "next/link";
import { notFound } from "next/navigation";
import { AskBox } from "@/components/AskBox";
import { BreadthBar } from "@/components/BreadthBar";
import { Delta } from "@/components/Delta";
import { LiveStamp } from "@/components/LiveStamp";
import { OnboardingWatchlist } from "@/components/OnboardingWatchlist";
import { FeedBanner } from "@/components/FeedBanner";
import { Heatmap } from "@/components/Heatmap";
import { JsonLd } from "@/components/JsonLd";
import { organizationLd, websiteLd } from "@/lib/seo";
import { siteUrl } from "@/lib/site";
import { QuoteTable } from "@/components/QuoteTable";
import { ReadAloud } from "@/components/ReadAloud";
import { SectorBars } from "@/components/SectorBars";
import { SectionHead } from "@/components/chrome";
import { Card, CtaLink, DarkPanel, Eyebrow } from "@/components/ui";
import { can, ALERT_LIMIT, INDICATOR_LIMIT } from "@/lib/auth/entitlement";
import { getSession, sessionsAvailable } from "@/lib/auth/session";
import { dbAvailable, getDb } from "@/lib/db";
import { activeProvider } from "@/lib/ask/provider";
import { freeAsksToShow } from "@/lib/ask/meter";
import { buildBrief } from "@/lib/brief";
import { num, vnd } from "@/lib/format";
import { getDict, href, isLocale, PATHS } from "@/lib/i18n";
import { getGold, headlineRow, premium } from "@/lib/providers/gold";
import { getBoard, getIndices } from "@/lib/providers/vnstock";
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
 * for the two asset classes the product is about — equities and gold — so a
 * visitor knows in a glance what today is. The AI box sits high because it
 * is the thing no other VN finance site has; the sign-in nudge turns a reader
 * into an account, which is what brings them back.
 */
export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const dict = getDict(locale);
  const viewAll = dict.common.viewAll;
  const session = await getSession();

  const [indicesR, boardR, goldR] = await Promise.allSettled([
    getIndices(), getBoard(), getGold(),
  ]);
  const indices = indicesR.status === "fulfilled" ? indicesR.value : [];
  const board = boardR.status === "fulfilled" ? boardR.value : [];
  const gold = goldR.status === "fulfilled" ? goldR.value : null;
  const { gainers, losers } = topMovers(board, 5);

  const goldTop = gold ? headlineRow(gold.rows) : undefined;
  const prem = gold?.world && goldTop ? premium(gold.world.buy, goldTop.sell, USD_VND) : null;
  const brief = buildBrief(locale, { indices, board, gold, goldHeadline: goldTop, premiumPct: prem?.pct });

  const vnindex = indices.find((i) => i.symbol === "VNINDEX") ?? indices[0];
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
      {/* The home page carried no structured data at all — the one page where a
          publisher graph is worth having. No SearchAction: symbol search is a
          client-side palette, and a search endpoint that cannot be called is a
          rich result that fails on click. */}
      <JsonLd data={organizationLd(siteUrl(), dict.brand, dict.home.subtitle)} />
      <JsonLd data={websiteLd(siteUrl(), dict.brand, locale)} />

      {/* ── Hero ────────────────────────────────────────────────────────────
          Left: what today is, in words, with the two ways in. Right: the same
          session as a picture — index, breadth, heatmap — on a raised card.
          A landing that opens on a market READ rather than a menu. */}
      <section className="grid items-start gap-10 pb-12 lg:grid-cols-[minmax(0,1fr)_520px] lg:gap-12">
        <div className="lg:pt-4">
          <span className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5">
            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-gold" />
            <Eyebrow>HOSE · HNX · UPCOM · {dict.nav.gold}</Eyebrow>
          </span>
          <h1 className="mt-5 max-w-[18ch] text-[40px] font-semibold leading-[1.05] tracking-[-0.035em] sm:text-[52px]">
            {dict.home.title}
          </h1>
          <p className="mt-5 max-w-[54ch] text-[16px] leading-relaxed text-ink-2 sm:text-[17px]">
            {dict.pricing.subtitle}
          </p>

          <div className="mt-7 flex flex-wrap gap-3">
            <CtaLink href={`/${locale}/${PATHS.stocks[locale]}`} variant="gold" size="lg">
              {dict.stocks.title} <span aria-hidden="true">→</span>
            </CtaLink>
            <CtaLink href={`/${locale}/${PATHS.pricing[locale]}`} variant="ghost" size="lg">
              {dict.nav.pricing}
            </CtaLink>
          </div>

          {/* Three facts about the product, taken from the model that enforces
              them — never a headline number typed into the page. */}
          <dl className="mt-10 flex flex-wrap gap-x-10 gap-y-5 border-t border-line pt-7">
            <HeroFact label={dict.nav.stocks} value={String(board.length)} />
            <HeroFact label={dict.pricing.fIndicators} value={`${INDICATOR_LIMIT.pro}+`} />
            <HeroFact label={dict.pricing.fAlerts} value={String(ALERT_LIMIT.pro)} />
          </dl>
        </div>

        <Card className="card-raised overflow-hidden">
          <div className="flex flex-wrap items-baseline justify-between gap-3 px-6 pt-6">
            <div>
              <div className="font-mono text-[11px] uppercase tracking-[0.1em] text-muted">VN-Index</div>
              {vnindex ? (
                <div className="mt-2 flex flex-wrap items-baseline gap-2.5">
                  <span className="tnum font-mono text-[34px] font-medium leading-none tracking-tight">
                    {num(vnindex.price, locale, 2)}
                  </span>
                  <Delta change={vnindex.change} changePct={vnindex.changePct} locale={locale} className="text-[14px]" />
                </div>
              ) : (
                <div className="mt-2 text-[14px] text-muted">{dict.common.noData}</div>
              )}
            </div>
            <div className="text-right">
              <div className="font-mono text-[11px] uppercase tracking-[0.1em] text-muted">{dict.stocks.title}</div>
              <div className="tnum mt-2 font-mono text-[14px]">
                <span className="text-up">{up} {dict.home.pulseAdv}</span>
                <span className="text-muted"> / </span>
                <span className="text-down">{down} {dict.home.pulseDec}</span>
              </div>
            </div>
          </div>

          {board.length > 0 && (
            <div className="px-6 pt-5">
              <BreadthBar
                up={up} down={down} flat={flat}
                labels={{ up: dict.home.pulseAdv, down: dict.home.pulseDec, flat: dict.common.flat }}
                showCounts={false}
              />
            </div>
          )}

          <div className="px-6 pb-6 pt-5">
            <div className="mb-3 flex items-center justify-between gap-3">
              <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-muted">{dict.heatmap.title}</span>
              <Link href={`/${locale}/${PATHS.heatmap[locale]}`} className="text-[12px] font-medium text-accent hover:underline">
                {viewAll} <span aria-hidden="true">→</span>
              </Link>
            </div>
            {board.length ? (
              <Heatmap quotes={board} locale={locale} height={230} max={20} />
            ) : (
              <FeedBanner dict={dict} detail={boardR.status === "rejected" ? String(boardR.reason) : undefined} />
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-page px-6 py-4">
            <span className="text-[13px] text-ink-2">{dict.gold.title}</span>
            {goldTop ? (
              <Link href={`/${locale}/${PATHS.gold[locale]}`} className="tnum flex items-baseline gap-2.5 font-mono text-[14px] hover:opacity-80">
                <span className="font-medium">{vnd(goldTop.sell, locale)}</span>
                <Delta change={goldTop.changeSell} locale={locale} digits={0} />
              </Link>
            ) : (
              <span className="text-[13px] text-muted">{dict.common.noData}</span>
            )}
          </div>
        </Card>
      </section>

      {/* The session in one line, with the clock that proves it is live. */}
      {board.length > 0 && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          {pulse && <span className="text-[16px] font-semibold">{pulse}</span>}
          <span className="font-mono text-[12px] text-muted">{dateLabel}</span>
          <LiveStamp locale={locale} />
        </div>
      )}

      {/* First-visit activation: pick a few symbols → the watchlist loop starts now. */}
      <OnboardingWatchlist dict={dict} locale={locale as Locale} />

      {/* Signed-in personalisation, up top: the reader's own board comes first. */}
      {watch.length > 0 && (
        <section className="mb-8">
          <SectionHead title={dict.home.yourWatch} href={`/${locale}/${PATHS.watchlist[locale]}`} viewAll={viewAll} />
          <QuoteTable quotes={watch} locale={locale} dict={dict} showWatch={false} compact />
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left: the movers, so the tall column carries the data. */}
        <div className="space-y-6 lg:col-span-2">
          <section>
            <SectionHead
              title={dict.home.movers}
              subtitle={dict.stocks.subtitle}
              href={`/${locale}/${PATHS.stocks[locale]}`}
              viewAll={viewAll}
            />
            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <h3 className="mb-2.5 font-mono text-[11px] uppercase tracking-[0.1em] text-muted">{dict.home.gainers}</h3>
                {board.length ? <QuoteTable quotes={gainers} locale={locale} dict={dict} showWatch={false} compact /> : <FeedBanner dict={dict} />}
              </div>
              <div>
                <h3 className="mb-2.5 font-mono text-[11px] uppercase tracking-[0.1em] text-muted">{dict.home.losers}</h3>
                {board.length ? <QuoteTable quotes={losers} locale={locale} dict={dict} showWatch={false} compact /> : <FeedBanner dict={dict} />}
              </div>
            </div>
          </section>

          <section>
            <SectionHead
              title={dict.home.rotation}
              subtitle={dict.home.rotationHint}
              href={`/${locale}/${PATHS.stocks[locale]}`}
              viewAll={viewAll}
            />
            {board.length ? (
              <Card className="p-5"><SectorBars board={board} locale={locale} dict={dict} /></Card>
            ) : (
              <FeedBanner dict={dict} />
            )}
          </section>
        </div>

        {/* Right rail: the differentiator first, then the reads that fill the column. */}
        <div className="space-y-6">
          <section>
            <SectionHead title={dict.home.askTitle} />
            <Card className="p-5">
              <p className="mb-3.5 text-[13px] leading-relaxed text-ink-2">{dict.home.askSub}</p>
              <AskBox locale={locale} isMock={activeProvider() === "mock"} tier={session?.tier ?? "anon"}
                freeAsks={freeAsksToShow(session?.tier ?? "anon", session?.asks, sessionsAvailable())} compact />
            </Card>
          </section>

          <section>
            <SectionHead title={dict.brief.title} href={`/${locale}/${PATHS.brief[locale]}`} viewAll={viewAll} />
            {brief.paragraphs.length ? (
              <Card className="p-5">
                <h3 className="text-[17px] font-semibold leading-snug tracking-tight">{brief.headline}</h3>
                <p className="mt-2.5 text-[14px] leading-relaxed text-ink-2">{brief.standfirst}</p>
                <div className="mt-4"><ReadAloud text={[brief.headline, brief.standfirst].join(". ")} dict={dict} locale={locale} /></div>
                <Link href={`/${locale}/${PATHS.brief[locale]}`} className="mt-4 inline-block text-[13px] font-medium text-accent hover:underline">
                  {dict.brief.title} <span aria-hidden="true">→</span>
                </Link>
              </Card>
            ) : (
              <FeedBanner dict={dict} />
            )}
          </section>
        </div>
      </div>

      {/* ── Why pay ─────────────────────────────────────────────────────────
          The four things that run on our servers after the reader closes the
          tab. Every row and its badge comes from the entitlement model, so the
          page can never advertise a feature the server does not grant. */}
      <PaidFeatures locale={locale} dict={dict} />

      {/* Reader → account: the loop that brings people back. */}
      <RetentionNudge locale={locale} dict={dict} signedIn={!!session?.email} />
    </>
  );
}

/** One figure in the hero's fact row. */
function HeroFact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="max-w-[22ch] font-mono text-[11px] uppercase tracking-[0.1em] text-muted">{label}</dt>
      <dd className="mt-2 font-mono text-[26px] font-medium tracking-tight">{value}</dd>
    </div>
  );
}

/**
 * The paid-feature panel. The badge on each card is derived: the LOWEST tier
 * whose entitlements include the capability. Nothing here is typed by hand, so
 * a change to `can()` moves the badges with it.
 */
function PaidFeatures({ locale, dict }: { locale: Locale; dict: ReturnType<typeof getDict> }) {
  const items = ([
    ["alerts:email", dict.pricing.fAlertEmail],
    ["use:ai-assistant", dict.pricing.fAi],
    ["chart:intraday", dict.pricing.fIntraday],
    ["chart:multi", dict.pricing.fMulti],
  ] as const).map(([cap, label]) => ({
    label,
    tier: can("plus", cap) ? dict.pricing.plus : dict.pricing.pro,
    top: !can("plus", cap),
  }));

  return (
    <DarkPanel
      className="mt-12"
      title={dict.pricing.title}
      body={dict.pricing.subtitle}
      cta={dict.pricing.cta}
      href={`/${locale}/${PATHS.pricing[locale]}`}
    >
      <ul className="mt-7 grid gap-4 sm:grid-cols-2">
        {items.map((it) => (
          <li key={it.label} className="rounded-[14px] border border-chrome-line bg-chrome-2 p-5">
            <span
              className={`inline-block rounded px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] ${
                it.top ? "bg-gold text-gold-ink" : "border border-gold-line text-gold"
              }`}
            >
              {it.tier}
            </span>
            <h3 className="mt-4 text-[16px] font-semibold leading-snug">{it.label}</h3>
          </li>
        ))}
      </ul>
    </DarkPanel>
  );
}

/** Sign-in / account nudge. Signed in, it points at the watchlist instead. */
function RetentionNudge({ locale, dict, signedIn }: { locale: Locale; dict: ReturnType<typeof getDict>; signedIn: boolean }) {
  return (
    <Card className="mt-6 flex flex-col gap-5 p-7 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h2 className="text-[20px] font-semibold tracking-tight">{signedIn ? dict.home.yourWatch : dict.home.saveTitle}</h2>
        <p className="mt-2 max-w-[64ch] text-[14px] leading-relaxed text-ink-2">{dict.home.saveBody}</p>
      </div>
      <div className="flex shrink-0 flex-wrap gap-3">
        <CtaLink
          href={signedIn ? `/${locale}/${PATHS.watchlist[locale]}` : `${href(locale, "login")}?next=${encodeURIComponent(`/${locale}/${PATHS.watchlist[locale]}`)}`}
          variant="gold"
        >
          {signedIn ? dict.home.yourWatch : dict.home.saveCta}
        </CtaLink>
        <CtaLink href={`/${locale}/${PATHS.pricing[locale]}`} variant="ghost">{dict.home.saveCta2}</CtaLink>
      </div>
    </Card>
  );
}
