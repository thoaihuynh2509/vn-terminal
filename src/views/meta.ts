import { PATHS } from "@/lib/i18n";
import type { Locale } from "@/lib/types";
import type { Metadata } from "next";

/**
 * Per-section metadata with a canonical that points at the section itself.
 *
 * The locale layout declares `alternates.canonical: "/{locale}"`, and metadata
 * is INHERITED — so until a page overrode it, every section told crawlers it
 * was a duplicate of the home page and asked them to index the home page
 * instead. That is not a missing optimisation, it is a page telling Google not
 * to rank it.
 *
 * `title` is the bare section name: the layout's title template appends the
 * brand. Callers pass the dictionary strings the page already renders, so the
 * description a searcher reads is the sentence the page shows and cannot drift.
 */
export function sectionMetadata(
  locale: Locale,
  key: keyof typeof PATHS,
  copy: { title: string; description: string },
  /** Trailing segment for a detail page, e.g. "/VNM" under the terminal. */
  rest = "",
): Metadata {
  const path = (l: Locale) => `/${l}/${PATHS[key][l]}${rest}`;
  return {
    title: copy.title,
    description: copy.description,
    alternates: {
      canonical: path(locale),
      languages: { "vi-VN": path("vi"), "en-US": path("en"), "x-default": path("vi") },
    },
    openGraph: {
      title: copy.title,
      description: copy.description,
      type: "website",
      url: path(locale),
    },
  };
}
