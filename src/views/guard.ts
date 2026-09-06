import { notFound } from "next/navigation";
import { isLocale, PATHS } from "@/lib/i18n";
import type { Locale } from "@/lib/types";

/**
 * Each section has one canonical spelling per locale (/vi/chung-khoan,
 * /en/stocks). Both folders exist so Next can route them, but serving the same
 * page at /vi/stocks would create duplicate URLs for crawlers — so the wrong
 * pairing 404s instead.
 */
export function guard(locale: string, key: keyof typeof PATHS, segment: string): Locale {
  if (!isLocale(locale)) notFound();
  if (PATHS[key][locale] !== segment) notFound();
  return locale;
}
