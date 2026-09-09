/**
 * schema.org graphs for the pages that had none.
 *
 * The boards already carry `FAQPage` through `Explainer`, but the home page and
 * the 60 VN30 chart URLs — the largest cohort in the sitemap, and the whole
 * long-tail play — emitted no structured data at all.
 *
 * Everything here is derived from the site's own navigation, never from market
 * data. A price in a graph is a claim about a number at a moment, and this
 * site's own disclaimer says the feed may lag; a breadcrumb is true regardless
 * of what the market did.
 */
import { PATHS } from "./i18n/index.ts";
import type { Locale } from "./types.ts";

export interface Crumb {
  name: string;
  /** Site-absolute path, e.g. `/vi/chung-khoan`. */
  path: string;
}

/** Who publishes this. */
export function organizationLd(site: string, name: string, description: string): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name,
    url: site,
    description,
  };
}

/**
 * The site itself, in every language it is published in.
 *
 * No `potentialAction`/`SearchAction`: symbol search here is a client-side
 * palette, not a URL a crawler can call. Declaring a search endpoint that does
 * not answer is a rich result that fails on click.
 */
export function websiteLd(site: string, name: string, locale: Locale): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name,
    url: `${site}/${locale}`,
    inLanguage: locale === "vi" ? "vi-VN" : "en-US",
    publisher: { "@type": "Organization", name, url: site },
  };
}

/**
 * Breadcrumb trail. Every entry must be a URL that answers 200 and is itself
 * indexable — a crumb pointing at a redirect spends the credit it was meant to
 * earn, which is why the chart's trail runs through the stocks board rather
 * than through bare `/bieu-do` (that one 307s to a default symbol).
 */
export function breadcrumbLd(site: string, trail: Crumb[]): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: c.name,
      item: `${site}${c.path}`,
    })),
  };
}

/** The trail for one symbol's chart, in the locale's own URL vocabulary. */
export function symbolTrail(locale: Locale, symbol: string, homeName: string, boardName: string): Crumb[] {
  return [
    { name: homeName, path: `/${locale}` },
    { name: boardName, path: `/${locale}/${PATHS.stocks[locale]}` },
    { name: symbol, path: `/${locale}/${PATHS.terminal[locale]}/${symbol}` },
  ];
}
