import Link from "next/link";
import { BriefArticle } from "@/components/BriefArticle";
import { FeedBanner } from "@/components/FeedBanner";
import { JsonLd } from "@/components/JsonLd";
import { Card } from "@/components/ui";
import { buildBrief } from "@/lib/brief";
import { loadBriefInputs } from "@/lib/briefs/load";
import { composeSnapshot } from "@/lib/briefs/snapshot";
import { tradingDay } from "@/lib/briefs/day";
import { getDict, PATHS } from "@/lib/i18n";
import { newsArticleLd } from "@/lib/seo";
import { siteUrl } from "@/lib/site";
import { dbAvailable, getDb } from "@/lib/db";
import type { Locale } from "@/lib/types";

/** How many past editions the index links to. */
const ARCHIVE_LINKS = 30;

export async function BriefView({ locale }: { locale: Locale }) {
  const dict = getDict(locale);
  const now = new Date();

  // The same gather the cron runs, so the emailed brief and this page can never
  // describe different numbers.
  const inputs = await loadBriefInputs({ sparks: true });
  const brief = buildBrief(locale, inputs);

  // Composed only for its visuals, which are exactly what the archived page
  // will redraw — one code path, so today's edition looks like every other.
  const visuals = composeSnapshot(tradingDay(now.getTime()), inputs, now.getTime()).visuals;

  const dateLabel = new Intl.DateTimeFormat(locale === "vi" ? "vi-VN" : "en-US", {
    weekday: "long", day: "2-digit", month: "long", year: "numeric",
    hour: "2-digit", minute: "2-digit", timeZone: "Asia/Ho_Chi_Minh",
  }).format(now);

  if (!brief.paragraphs.length) {
    return (
      <>
        <h1 className="text-[20px] font-semibold tracking-tight">{dict.brief.title}</h1>
        <p className="mb-5 mt-1 text-[13px] text-ink-2">{dict.brief.subtitle}</p>
        <FeedBanner dict={dict} />
      </>
    );
  }

  return (
    <>
      <JsonLd
        data={newsArticleLd({
          site: siteUrl(),
          path: `/${locale}/${PATHS.brief[locale]}`,
          headline: brief.headline,
          description: brief.standfirst,
          locale,
          datePublished: now.toISOString(),
          publisher: dict.brand,
        })}
      />
      <BriefArticle locale={locale} dict={dict} brief={brief} visuals={visuals} dateLabel={dateLabel} />
      <BriefArchiveIndex locale={locale} />
    </>
  );
}

/**
 * Links to the editions already stored.
 *
 * This is the only route into the archive a reader or a crawler has from
 * inside the site: a page in the sitemap that nothing links to is a page
 * Google is entitled to treat as an orphan.
 */
async function BriefArchiveIndex({ locale }: { locale: Locale }) {
  if (!dbAvailable()) return null;
  const dict = getDict(locale);

  let days: { day: string }[] = [];
  try {
    const db = await getDb();
    days = await db.briefs.recent(ARCHIVE_LINKS);
  } catch {
    // An archive we cannot read is not an error worth showing on a page whose
    // own content rendered perfectly well.
    return null;
  }
  if (!days.length) return null;

  const fmt = new Intl.DateTimeFormat(locale === "vi" ? "vi-VN" : "en-US", {
    weekday: "long", day: "2-digit", month: "long", year: "numeric", timeZone: "Asia/Ho_Chi_Minh",
  });

  return (
    <section className="mt-10" aria-labelledby="brief-archive-title">
      <h2 id="brief-archive-title" className="text-[14px] font-semibold tracking-tight">
        {dict.brief.archive}
      </h2>
      <Card className="mt-3 p-2">
        <ul>
          {days.map(({ day }) => (
            <li key={day} className="border-b border-line last:border-0">
              <Link
                href={`/${locale}/${PATHS.brief[locale]}/${day}`}
                className="block px-2 py-2 text-[13px] text-ink-2 hover:text-accent"
              >
                {/* Noon UTC keeps the label on the intended ICT calendar day. */}
                {fmt.format(new Date(`${day}T12:00:00Z`))}
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
}
