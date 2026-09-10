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

/**
 * The board as a ranked list of the pages behind it.
 *
 * A price table is an opaque grid to a crawler: thirty rows of numbers with no
 * statement about what they are or where each one leads. `ItemList` says the
 * page is an ordered index and hands over the thirty URLs, which is the same
 * claim the visible table makes.
 *
 * No price, change or volume fields, for the reason the rest of this file gives:
 * the feed may lag, and a number in a graph is a claim to a machine that will
 * repeat it. Position and destination are true whatever the market did.
 */
export function itemListLd(site: string, items: { name: string; path: string }[]): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    numberOfItems: items.length,
    itemListOrder: "https://schema.org/ItemListOrderAscending",
    itemListElement: items.map((it, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: it.name,
      url: `${site}${it.path}`,
    })),
  };
}

/**
 * One dated edition of the brief, as an article.
 *
 * `datePublished` is the day the edition covers, not the moment the page was
 * rendered — that is the whole difference between an archive and a page that
 * rewrites itself. The live brief passes today; an archived one passes the day
 * it was captured.
 */
export function newsArticleLd(o: {
  site: string;
  path: string;
  headline: string;
  description: string;
  locale: Locale;
  datePublished: string;
  dateModified?: string;
  publisher: string;
}): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    mainEntityOfPage: { "@type": "WebPage", "@id": `${o.site}${o.path}` },
    headline: o.headline,
    description: o.description,
    datePublished: o.datePublished,
    dateModified: o.dateModified ?? o.datePublished,
    inLanguage: o.locale === "vi" ? "vi-VN" : "en-US",
    author: { "@type": "Organization", name: o.publisher },
    publisher: { "@type": "Organization", name: o.publisher },
  };
}
