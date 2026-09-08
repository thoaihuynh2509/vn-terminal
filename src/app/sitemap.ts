import type { MetadataRoute } from "next";
import { LOCALES, PATHS } from "@/lib/i18n";
import { VN30 } from "@/lib/providers/vnstock";
import { siteUrl } from "@/lib/site";
import { cryptoEnabled } from "@/lib/flags";

const SITE = siteUrl();

// The sitemap reads CRYPTO_ENABLED, and the flag's contract is that it can be
// flipped from the Vercel dashboard without a redeploy. Nav, footer and the
// brief honour that because they render per request; a build-time sitemap would
// keep advertising (or omitting) /crypto until the next deploy.
export const dynamic = "force-dynamic";

export default function sitemap(): MetadataRoute.Sitemap {
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
  return out;
}
