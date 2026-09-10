import { NextResponse } from "next/server";
import { getSession, encodeSession, cookieOptions, sessionsAvailable, SESSION_COOKIE } from "@/lib/auth/session";
import { remintSession } from "@/lib/auth/remint";
import { subscriptionExp } from "@/lib/auth/provider";
import { dbAvailable, getDb, DbUnavailableError } from "@/lib/db";

export const runtime = "nodejs";
export const revalidate = 0;

/**
 * Re-mint the session cookie from the account row.
 *
 * The cookie carries a tier snapshot; a purchase (or an admin change) updates
 * the row, and this issues a fresh cookie so the new tier shows without waiting
 * for the next sign-in. It reads only the caller's OWN row and re-derives the
 * tier from it — a caller can never mint a tier the record does not hold.
 */
export async function POST() {
  const session = await getSession();
  if (!session?.email) {
    return NextResponse.json({ ok: false, error: "sign_in_required" }, { status: 401 });
  }
  if (!sessionsAvailable() || !dbAvailable()) {
    return NextResponse.json({ ok: false, error: "auth_not_configured" }, { status: 501 });
  }

  try {
    const db = await getDb();
    const user = await db.users.findByEmail(session.email);
    if (!user) {
      return NextResponse.json({ ok: false, error: "no_account" }, { status: 404 });
    }

    const exp = subscriptionExp(user);
    // Both meters ride across: the free-article list and the free-AI asks.
    const next = remintSession(user, { read: session.read, asks: session.asks }, Math.floor(Date.now() / 1000));
    const res = NextResponse.json(
      { ok: true, data: { tier: next.tier, exp: exp ?? null } },
      { headers: { "Cache-Control": "private, no-store" } },
    );
    res.cookies.set(SESSION_COOKIE, await encodeSession(next), cookieOptions());
    return res;
  } catch (err) {
    if (err instanceof DbUnavailableError) {
      return NextResponse.json({ ok: false, error: "auth_not_configured" }, { status: 501 });
    }
    throw err;
  }
}
