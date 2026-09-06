import type { MetadataRoute } from "next";
import { LOCALES, PATHS } from "@/lib/i18n";
import { VN30 } from "@/lib/providers/vnstock";
import { siteUrl } from "@/lib/site";

const SITE = siteUrl();

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const out: MetadataRoute.Sitemap = [];

  for (const locale of LOCALES) {
    out.push({ url: `${SITE}/${locale}`, lastModified: now, changeFrequency: "hourly", priority: 1 });
    for (const key of ["stocks", "gold", "crypto", "brief", "heatmap", "pricing", "terminal"] as const) {
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
