import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSession, encodeSession, cookieOptions, SESSION_COOKIE } from "@/lib/auth/session";
import { carriedAsks, remintSession } from "@/lib/auth/remint";
import { isDevAuth, looksLikeEmail } from "@/lib/auth/provider";
import { dbAvailable, getDb, DbUnavailableError } from "@/lib/db";
import type { StoredTier } from "@/lib/db";
import { captureServer, INTERACTIVE_CAPTURE_MS } from "@/lib/analytics/server";
import { signupCompletedEvent } from "@/lib/analytics/conversion";
import { clientIp, createLimiter } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const revalidate = 0;

// Bounded per-IP attempts; a sign-in endpoint is always probed.
const limited = createLimiter({ windowMs: 60_000, max: 10 });

/** Dev only: the tier selector is request data, so it never leaves this route. */
function requestedTier(requested: unknown): StoredTier | null {
  return requested === "plus" || requested === "pro" || requested === "free" ? requested : null;
}

export async function POST(req: Request) {
  if (!isDevAuth()) {
    // Never let the passwordless dev path answer on a real deployment.
    return NextResponse.json({ ok: false, error: "auth_not_configured" }, { status: 501 });
  }
  if (!dbAvailable()) {
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

  const { email, tier } = (body ?? {}) as { email?: unknown; tier?: unknown };
  if (!looksLikeEmail(email)) {
    return NextResponse.json({ ok: false, error: "invalid_email" }, { status: 400 });
  }
  const address = email.toLowerCase();

  let user;
  try {
    const db = await getDb();
    user = await db.users.upsertByEmail(address);
    // Only a genuinely new row is a sign-up, exactly as on the magic-link rail;
    // read before setTier below, which returns a row without the flag. A person
    // is waiting on this response, so it takes the interactive budget.
    if (user.created) await captureServer(signupCompletedEvent(user.email), { timeoutMs: INTERACTIVE_CAPTURE_MS });
    // The request may MUTATE the record (dev only); the session then reads it
    // back. A tier minted straight from the body is a tier the account was
    // never granted.
    const asked = requestedTier(tier);
    if (asked) user = (await db.users.setTier(address, asked)) ?? user;
    // Attribute a referral captured at landing. A no-op if none, already set,
    // invalid or self — the driver enforces set-once and no self-referral.
    const ref = (await cookies()).get("vnt_ref")?.value;
    if (ref) await db.users.setReferredBy(address, ref);
  } catch (err) {
    if (err instanceof DbUnavailableError) {
      return NextResponse.json({ ok: false, error: "auth_not_configured" }, { status: 501 });
    }
    throw err;
  }

  // `read` resets at sign-in as it always has; the free-AI meter carries over
  // from the anonymous session so signing in does not refill it — but only when
  // it is this reader's, never the last person to use the browser.
  const prior = await getSession();
  const session = remintSession(user, { read: [], asks: carriedAsks(prior, address) }, Math.floor(Date.now() / 1000));

  const res = NextResponse.json({ ok: true, data: { email: session.email, tier: session.tier } });
  res.cookies.set(SESSION_COOKIE, await encodeSession(session), cookieOptions());
  return res;
}
