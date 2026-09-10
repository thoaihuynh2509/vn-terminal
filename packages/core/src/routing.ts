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

/**
 * The host a request should be answered on, or null to answer where it landed.
 *
 * Once a custom domain is the canonical origin, the old `*.vercel.app` host
 * still serves every page — the same content at a second origin, which splits
 * whatever authority the domain is accruing and is the one duplication a
 * canonical tag cannot fix, because the duplicate is a whole host.
 *
 * Three guards, and each one matters:
 *
 * - Production only. `VERCEL_ENV` is "preview" on a branch deploy, and
 *   redirecting a preview to production would make every preview URL show the
 *   live site — the deploys exist precisely to be different.
 * - Only ever redirects AWAY from a `.vercel.app` host. A custom domain that is
 *   not the configured one (a second domain, a staging alias) is left alone;
 *   this is not a general canonicaliser.
 * - Never redirects to itself, so before NEXT_PUBLIC_SITE_URL is set — when the
 *   canonical origin IS the vercel host — nothing moves and there is no loop.
 */
export function canonicalRedirect(
  host: string | null,
  canonicalOrigin: string,
  vercelEnv: string | undefined,
): string | null {
  if (vercelEnv !== "production") return null;
  if (!host) return null;
  const from = host.toLowerCase().split(":")[0];
  if (!from.endsWith(".vercel.app")) return null;

  let to: string;
  try {
    to = new URL(canonicalOrigin).host.toLowerCase();
  } catch {
    return null;
  }
  if (!to || to === from) return null;
  return to;
}
