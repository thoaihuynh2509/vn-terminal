import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { activeAuthProvider } from "@/lib/auth/provider";
import { cookieOptions, encodeSession, getSession, sessionsAvailable, SESSION_COOKIE } from "@/lib/auth/session";
import { carriedAsks, remintSession } from "@/lib/auth/remint";
import { hashToken, safeRedirect } from "@/lib/auth/magic";
import { sameOrigin } from "@/lib/auth/same-origin";
import { dbAvailable, getDb, DbUnavailableError } from "@/lib/db";
import { captureServer, INTERACTIVE_CAPTURE_MS } from "@/lib/analytics/server";
import { signupCompletedEvent } from "@/lib/analytics/conversion";
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
  // Login-CSRF: signing a victim into an attacker's account is a real attack.
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
    // Only a genuinely new row is a sign-up; every later redemption is the same
    // reader coming back. Bounded and swallowed inside captureServer, on the
    // shorter budget because a person is watching this redirect resolve.
    if (user.created) await captureServer(signupCompletedEvent(user.email), { timeoutMs: INTERACTIVE_CAPTURE_MS });
    const ref = (await cookies()).get("vnt_ref")?.value;
    if (ref) await db.users.setReferredBy(hit.email, ref); // no-op unless valid, unset and not self
    // `read` resets at sign-in; the free-AI meter carries over from the
    // anonymous session so redeeming a link does not refill it — but only when
    // it is this reader's, never the last person to use the browser.
    const prior = await getSession();
    const session = remintSession(user, { read: [], asks: carriedAsks(prior, user.email) }, Math.floor(Date.now() / 1000));
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
