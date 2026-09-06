import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { activeAuthProvider, resolveTier, subscriptionExp } from "@/lib/auth/provider";
import { cookieOptions, encodeSession, sessionsAvailable, SESSION_COOKIE } from "@/lib/auth/session";
import { hashToken, linkOrigin, safeRedirect } from "@/lib/auth/magic";
import { dbAvailable, getDb, DbUnavailableError } from "@/lib/db";
import { isLocale, PATHS } from "@/lib/i18n";
import type { Locale } from "@/lib/types";

export const runtime = "nodejs";
export const revalidate = 0;

/**
 * Redeem a sign-in link. POST only, deliberately: mail scanners, Gmail
 * prefetch and Outlook Safe Links follow GET links and would burn the token
 * before the reader arrives. Scanners do not submit forms. There is no GET
 * handler here and there must never be one.
 */

/** Canonical origin first — a poisoned Host must not decide what counts as ours. */
function canonicalOrigin(req: Request): string {
  return linkOrigin() ?? new URL(req.url).origin;
}

/**
 * Login-CSRF: signing a victim into an attacker's account is a real attack.
 * Every current browser sends Sec-Fetch-Site; the clients that do not (Safari
 * before 16.4, old webviews) still send Origin on a form POST, so they must
 * prove same-origin with it. A POST carrying neither is not a browser we can
 * vouch for.
 */
function sameOrigin(req: Request): boolean {
  const site = req.headers.get("sec-fetch-site");
  if (site === null) return req.headers.get("origin") === canonicalOrigin(req);
  return site === "same-origin" || site === "none";
}

/**
 * 303, not Next's 307: the browser is following a form POST and must switch to
 * GET. The Location is relative so no Host header can steer it.
 */
function redirect(path: string): NextResponse {
  return new NextResponse(null, { status: 303, headers: { Location: path } });
}

/** The no-JS form posts urlencoded; a scripted client may post JSON. */
async function readBody(req: Request): Promise<{ token: string; locale: Locale }> {
  const type = req.headers.get("content-type") ?? "";
  let token: unknown;
  let locale: unknown;
  if (type.includes("application/json")) {
    const body = (await req.json().catch(() => ({}))) as { token?: unknown; locale?: unknown };
    token = body?.token;
    locale = body?.locale;
  } else {
    const form = await req.formData();
    token = form.get("token");
    locale = form.get("locale");
  }
  return {
    token: typeof token === "string" ? token : "",
    locale: typeof locale === "string" && isLocale(locale) ? locale : "vi",
  };
}

export async function POST(req: Request) {
  if (!sameOrigin(req)) {
    return NextResponse.json({ ok: false, error: "cross_site" }, { status: 403 });
  }

  if (activeAuthProvider() !== "magic" || !sessionsAvailable() || !dbAvailable()) {
    return NextResponse.json({ ok: false, error: "auth_not_configured" }, { status: 501 });
  }

  const { token, locale } = await readBody(req);
  const invalid = () => redirect(`/${locale}/${PATHS.login[locale]}?error=link_invalid`);

  if (!token) return invalid();

  try {
    const db = await getDb();
    const hit = await db.magicTokens.consume(await hashToken(token), new Date());
    if (!hit) return invalid();

    const user = await db.users.upsertByEmail(hit.email);
    const ref = (await cookies()).get("vnt_ref")?.value;
    if (ref) await db.users.setReferredBy(hit.email, ref); // no-op unless valid, unset and not self
    const exp = subscriptionExp(user);
    const session = {
      email: user.email,
      tier: resolveTier(user),
      read: [] as string[],
      iat: Math.floor(Date.now() / 1000),
      ...(exp !== undefined ? { exp } : {}),
    };
    // Re-validated even though it was checked at request time: the row is the
    // only thing between a tampered redirect and the reader's browser.
    const res = redirect(safeRedirect(hit.redirectTo, locale));
    res.cookies.set(SESSION_COOKIE, await encodeSession(session), cookieOptions());
    return res;
  } catch (err) {
    if (err instanceof DbUnavailableError) {
      return NextResponse.json({ ok: false, error: "auth_not_configured" }, { status: 501 });
    }
    throw err;
  }
}
