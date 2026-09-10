import Link from "next/link";
import { notFound } from "next/navigation";
import { BriefArticle } from "@/components/BriefArticle";
import { JsonLd } from "@/components/JsonLd";
import { parseSnapshot } from "@/lib/briefs/snapshot";
import { parseDay } from "@/lib/briefs/day";
import { dbAvailable, getDb } from "@/lib/db";
import { getDict, PATHS } from "@/lib/i18n";
import { newsArticleLd } from "@/lib/seo";
import { siteUrl } from "@/lib/site";
import type { BriefSnapshot } from "@/lib/briefs/snapshot";
import type { Locale } from "@/lib/types";

/**
 * One stored edition, read back exactly as it was published.
 *
 * Every way this can fail is the same 404: an unparseable date, a database we
 * cannot reach, a day with no session, a document too old to read. A dated URL
 * either has an edition behind it or it does not exist — there is no partial
 * version of "the brief for the 10th" worth serving.
 */
export async function loadSnapshot(day: string): Promise<BriefSnapshot | null> {
  if (!dbAvailable()) return null;
  try {
    const db = await getDb();
    const row = await db.briefs.get(day);
    return row ? parseSnapshot(row.data) : null;
  } catch {
    return null;
  }
}

export async function BriefArchiveView({ locale, date }: { locale: Locale; date: string }) {
  const day = parseDay(date);
  // notFound() at the top level of the page, outside any Suspense boundary, is
  // what makes this a real 404 status rather than 200 carrying 404 markup.
  if (!day) notFound();

  const snapshot = await loadSnapshot(day);
  if (!snapshot) notFound();

  const dict = getDict(locale);
  const brief = locale === "vi" ? snapshot.vi : snapshot.en;

  const dateLabel = new Intl.DateTimeFormat(locale === "vi" ? "vi-VN" : "en-US", {
    weekday: "long", day: "2-digit", month: "long", year: "numeric", timeZone: "Asia/Ho_Chi_Minh",
  }).format(new Date(`${day}T12:00:00Z`));

  return (
    <>
      <JsonLd
        data={newsArticleLd({
          site: siteUrl(),
          path: `/${locale}/${PATHS.brief[locale]}/${day}`,
          headline: brief.headline,
          description: brief.standfirst,
          locale,
          // The day the edition covers, not the moment this page rendered.
          datePublished: snapshot.capturedAt,
          publisher: dict.brand,
        })}
      />

      <BriefArticle locale={locale} dict={dict} brief={brief} visuals={snapshot.visuals} dateLabel={dateLabel} />

      <p className="mt-8 max-w-[68ch] text-[12px] leading-relaxed text-ink-2">
        {dict.brief.archivedNote.replace("{day}", dateLabel)}
      </p>
      <p className="mt-3">
        <Link href={`/${locale}/${PATHS.brief[locale]}`} className="text-[13px] text-accent hover:underline">
          {dict.brief.backToLatest}
        </Link>
      </p>
    </>
  );
}
