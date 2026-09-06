import { NextResponse, type NextRequest } from "next/server";
import { DEFAULT_LOCALE, LOCALES } from "@/lib/i18n";
import { normalizeCode } from "@/lib/billing/referral";

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
export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (LOCALES.some((l) => pathname === `/${l}` || pathname.startsWith(`/${l}/`))) {
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
