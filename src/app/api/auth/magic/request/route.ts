import { NextResponse } from "next/server";
import { activeAuthProvider, looksLikeEmail } from "@/lib/auth/provider";
import { sessionsAvailable } from "@/lib/auth/session";
import {
  generateToken,
  hashToken,
  linkOrigin,
  magicLinkUrl,
  safeRedirect,
  MAGIC_TTL_MS,
  MAX_LINKS_PER_EMAIL_PER_HOUR,
} from "@/lib/auth/magic";
import { mailAvailable, sendMagicLink } from "@/lib/auth/mailer";
import { dbAvailable, getDb, DbUnavailableError } from "@/lib/db";
import { isLocale } from "@/lib/i18n";
import { clientIp, createLimiter } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const revalidate = 0;

const HOUR_MS = 60 * 60_000;

// Bounded per-IP attempts; a sign-in endpoint is always probed.
const limited = createLimiter({ windowMs: 60_000, max: 10 });

/**
 * Everything a mailed link needs before one is minted: a provider, a signing
 * key, storage, a channel that is not the server log, and an origin we own. A
 * deployment missing any of them says so instead of minting tokens nobody will
 * ever receive.
 */
function deliverable(): boolean {
  return (
    activeAuthProvider() === "magic" &&
    sessionsAvailable() &&
    dbAvailable() &&
    mailAvailable() &&
    linkOrigin() !== null
  );
}

/**
 * Ask for a sign-in link.
 *
 * Every well-formed address gets the same 200 and the same body — new, known,
 * throttled or undeliverable. There is deliberately no branch on whether the
 * account exists, because the answer to that question is exactly what an
 * enumerator wants. The user row is created at verify time, not here.
 */
export async function POST(req: Request) {
  if (!deliverable()) {
    return NextResponse.json({ ok: false, error: "auth_not_configured" }, { status: 501 });
  }

  if (limited(clientIp(req))) {
    return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429, headers: { "Retry-After": "60" } });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 400 });
  }

  const { email, next, locale: asked } = (body ?? {}) as { email?: unknown; next?: unknown; locale?: unknown };
  if (!looksLikeEmail(email)) {
    return NextResponse.json({ ok: false, error: "invalid_email" }, { status: 400 });
  }

  const address = email.toLowerCase();
  const locale = typeof asked === "string" && isLocale(asked) ? asked : "vi";
  const redirectTo = safeRedirect(typeof next === "string" ? next : null, locale);
  const now = new Date();

  try {
    const db = await getDb();
    const recent = await db.magicTokens.countRecent(address, new Date(now.getTime() - HOUR_MS));
    if (recent < MAX_LINKS_PER_EMAIL_PER_HOUR) {
      const token = generateToken();
      await db.magicTokens.insert(
        {
          tokenHash: await hashToken(token),
          email: address,
          redirectTo,
          expiresAt: new Date(now.getTime() + MAGIC_TTL_MS),
        },
        now,
      );
      try {
        await sendMagicLink({ to: address, url: magicLinkUrl(token, locale), locale });
      } catch (err) {
        // A dead mail provider must not tell the caller whose address it was.
        console.error("[magic-link] delivery failed", err);
      }
    }
    // Over the rolling-hour ceiling: nothing sent, same answer as a send.
  } catch (err) {
    if (err instanceof DbUnavailableError) {
      return NextResponse.json({ ok: false, error: "auth_not_configured" }, { status: 501 });
    }
    throw err;
  }

  return NextResponse.json({ ok: true });
}
