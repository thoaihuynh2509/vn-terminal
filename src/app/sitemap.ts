import type { MetadataRoute } from "next";
import { LOCALES, PATHS } from "@/lib/i18n";
import { VN30 } from "@/lib/providers/vnstock";
import { siteUrl } from "@/lib/site";
import { cryptoEnabled } from "@/lib/flags";
import { dbAvailable, getDb } from "@/lib/db";

const SITE = siteUrl();

// The sitemap reads CRYPTO_ENABLED, and the flag's contract is that it can be
// flipped from the Vercel dashboard without a redeploy. Nav, footer and the
// brief honour that because they render per request; a build-time sitemap would
// keep advertising (or omitting) /crypto until the next deploy.
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const out: MetadataRoute.Sitemap = [];
  // With the crypto flag off `/crypto` 404s, and a sitemap that advertises a
  // 404 costs crawl budget and trust on every other URL in the file.
  // `terminal` is deliberately absent: the bare /bieu-do 307s to the default
  // symbol, and a sitemap that lists a redirect spends crawl budget to be told
  // to go somewhere already listed below.
  const sections = cryptoEnabled()
    ? (["stocks", "gold", "crypto", "brief", "heatmap", "pricing"] as const)
    : (["stocks", "gold", "brief", "heatmap", "pricing"] as const);

  for (const locale of LOCALES) {
    out.push({ url: `${SITE}/${locale}`, lastModified: now, changeFrequency: "hourly", priority: 1 });
    for (const key of sections) {
      out.push({
        url: `${SITE}/${locale}/${PATHS[key][locale]}`,
        lastModified: now,
        changeFrequency: "hourly",
        priority: 0.8,
      });
    }
    for (const sym of VN30) {
      out.push({
        url: `${SITE}/${locale}/${PATHS.terminal[locale]}/${sym}`,
        lastModified: now,
        changeFrequency: "daily",
        priority: 0.6,
      });
    }
  }

  // One URL per archived session, in both locales.
  //
  // Only days that actually have a stored row are listed: an archive advertising
  // a date the cron never ran for is a 404 in a sitemap, which is the same
  // mistake as listing /crypto with the flag off. Capped at a year — beyond
  // that the pages still resolve, they simply stop being re-advertised.
  if (dbAvailable()) {
    try {
      const db = await getDb();
      const days = await db.briefs.recent(365);
      for (const locale of LOCALES) {
        for (const { day, updatedAt } of days) {
          out.push({
            url: `${SITE}/${locale}/${PATHS.brief[locale]}/${day}`,
            lastModified: updatedAt,
            // A published edition never changes again.
            changeFrequency: "yearly",
            priority: 0.5,
          });
        }
      }
    } catch {
      // A sitemap missing its archive still correctly describes every other
      // page; failing the whole file would de-list the site over one query.
    }
  }

  return out;
}
