/**
 * Route-level authorization decisions, made from the PATH alone.
 *
 * These live here, and are applied in the proxy, for one reason: a 404 has to
 * be decided before the response starts. Once a route begins streaming its
 * shell the status is already sent, and `notFound()` inside a Suspense boundary
 * can only change the markup, not the code. Both of the rules below exist for
 * their STATUS — one so an internal page never admits it exists, the other so
 * crawlers never see the same page at two URLs — so both have to be settled up
 * front.
 *
 * The pages keep their own checks. This decides the status; the page still
 * refuses to render the data, because authorization that lives only in a proxy
 * is one misconfigured matcher away from being no authorization at all.
 *
 * Pure: no request object, no crypto, no framework.
 */
import { LOCALES, PATHS, isLocale } from "./i18n/index.ts";

/** Every localized segment that belongs to a given locale. */
function segmentsFor(locale: string): Set<string> {
  const out = new Set<string>();
  for (const pair of Object.values(PATHS)) {
    out.add(pair[locale as keyof typeof pair]);
  }
  return out;
}

/** Segments that are the same in both locales and so can never be mispaired. */
const SHARED = new Set(["admin"]);

/**
 * Whether a path's first segment is spelled for its own locale.
 *
 * `/vi/gold` is the English spelling under the Vietnamese locale: the same page
 * at a second URL, which is what `guard()` has always refused. Unknown segments
 * are ALLOWED through — this decides mispairing, not existence, and a route
 * that does not exist is Next's 404 to give, not ours.
 */
export function localeSegmentOk(pathname: string): boolean {
  const parts = pathname.split("/").filter(Boolean);
  const [locale, segment] = parts;
  if (!locale || !isLocale(locale) || !segment) return true;
  if (SHARED.has(segment)) return true;

  const mine = segmentsFor(locale);
  if (mine.has(segment)) return true;

  // Only refuse when the segment is the OTHER locale's spelling of a real
  // section. Anything else is simply an unknown path.
  for (const other of LOCALES) {
    if (other === locale) continue;
    if (segmentsFor(other).has(segment)) return false;
  }
  return true;
}

/** Whether a path is the owner-only reconciliation view. */
export function isAdminPath(pathname: string): boolean {
  const parts = pathname.split("/").filter(Boolean);
  return parts.length === 2 && isLocale(parts[0]) && parts[1] === "admin";
}
