import { BriefArchiveView, loadSnapshot } from "@/views/BriefArchiveView";
import { guard } from "@/views/guard";
import { sectionMetadata } from "@/views/meta";
import { parseDay } from "@/lib/briefs/day";
import { getDict } from "@/lib/i18n";

/**
 * One trading day's brief.
 *
 * Dynamic by construction — no `generateStaticParams`, and the snapshot read
 * makes it so — because the set of dates grows by one every afternoon and a
 * prerendered list would be stale the day after each deploy.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; date: string }>;
}) {
  const { locale: raw, date } = await params;
  const locale = guard(raw, "brief", "ban-tin");
  const d = getDict(locale).brief;
  const day = parseDay(date);
  if (!day) return { title: d.title, robots: { index: false, follow: false } };

  const snapshot = await loadSnapshot(day);
  const brief = snapshot ? (locale === "vi" ? snapshot.vi : snapshot.en) : null;
  // The stored headline is the day's own, so no two editions share a title —
  // the failure that makes an archive look like duplicate content.
  return sectionMetadata(
    locale,
    "brief",
    {
      title: d.archiveOf.replace("{day}", day),
      description: brief?.standfirst ?? d.subtitle,
    },
    `/${day}`,
    { publishedTime: snapshot?.capturedAt ?? `${day}T00:00:00.000Z` },
  );
}

export default async function Page({ params }: { params: Promise<{ locale: string; date: string }> }) {
  const { locale, date } = await params;
  return <BriefArchiveView locale={guard(locale, "brief", "ban-tin")} date={date} />;
}
