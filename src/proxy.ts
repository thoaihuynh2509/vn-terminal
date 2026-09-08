import { NextResponse, type NextRequest } from "next/server";
import { DEFAULT_LOCALE, LOCALES } from "@/lib/i18n";
import { normalizeCode } from "@/lib/billing/referral";
import { isAdminPath, localeSegmentOk } from "@/lib/routing";
import { decodeSession, SESSION_COOKIE } from "@/lib/auth/token";
import { isAdmin } from "@/lib/auth/admin";

const REF_COOKIE = "vnt_ref";
const REF_MAX_AGE = 60 * 60 * 24 * 30; // 30 days to convert

/** A `?ref=CODE` on any entry is remembered so signup can attribute it later. */
function captureRef(req: NextRequest, res: NextResponse): NextResponse {
  const ref = normalizeCode(req.nextUrl.searchParams.get("ref"));
  if (ref && req.cookies.get(REF_COOKIE)?.value !== ref) {
    res.cookies.set(REF_COOKIE, ref, { httpOnly: true, sameSite: "lax", path: "/", maxAge: REF_MAX_AGE });
  }
  return res;
}

/**
 * Next 16 renamed the `middleware` convention to `proxy` (nodejs runtime only).
 * Every page lives under /:locale; bare paths get a locale prefix.
 */
/**
 * Refuse a route before it renders.
 *
 * Rewritten to a path that matches nothing, so Next serves its own not-found
 * page with a 404 STATUS. That is the whole point of deciding here: once a
 * route starts streaming its shell the status has already been sent, and
 * `notFound()` can then only change the markup.
 */
function refuse(req: NextRequest): NextResponse {
  const url = req.nextUrl.clone();
  url.pathname = "/_vnt_not_found";
  url.search = "";
  return NextResponse.rewrite(url);
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (LOCALES.some((l) => pathname === `/${l}` || pathname.startsWith(`/${l}/`))) {
    // The same page under the other locale's spelling is a duplicate URL.
    if (!localeSegmentOk(pathname)) return refuse(req);

    // The owner-only view. Decided here so a refusal is a real 404 rather than
    // a 200 carrying not-found markup; the page re-checks before reading data,
    // because authorization that lives only in a proxy is one misconfigured
    // matcher away from being none.
    if (isAdminPath(pathname)) {
      const session = await decodeSession(req.cookies.get(SESSION_COOKIE)?.value);
      if (!isAdmin(session?.email)) return refuse(req);
    }
    return captureRef(req, NextResponse.next());
  }
  const prefers = req.headers.get("accept-language")?.toLowerCase() ?? "";
  const locale = prefers.startsWith("en") ? "en" : DEFAULT_LOCALE;
  const url = req.nextUrl.clone();
  url.pathname = `/${locale}${pathname === "/" ? "" : pathname}`;
  return captureRef(req, NextResponse.redirect(url));
}

export const config = {
  matcher: ["/((?!api|_next|favicon.ico|robots.txt|sitemap.xml|.*\\..*).*)"],
};
