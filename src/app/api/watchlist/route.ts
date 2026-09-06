import { NextResponse } from "next/server";
import { can } from "@/lib/auth/entitlement";
import { getSession } from "@/lib/auth/session";
import { dbAvailable, getDb, DbUnavailableError, type Db } from "@/lib/db";

export const runtime = "nodejs";
export const revalidate = 0;

const SYMBOL = /^[A-Z0-9]{1,10}$/;
const MAX_PER_CALL = 50;
const MAX_PER_USER = 200;

/**
 * A watchlist belongs to one reader, so every response here is uncacheable.
 * `ok()` from @/lib/api emits `public, s-maxage=60` — a CDN would hand one
 * reader's list to the next.
 */
function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

type Resolved = { res: NextResponse } | { db: Db; userId: string };

async function resolveUser(): Promise<Resolved> {
  const session = await getSession();
  if (!session) return { res: json({ ok: false, error: "unauthorized" }, 401) };
  if (!can(session.tier, "save:watchlist")) {
    return { res: json({ ok: false, error: "upgrade_required", tier: session.tier }, 402) };
  }
  if (!dbAvailable()) return { res: json({ ok: false, error: "auth_not_configured" }, 501) };

  const db = await getDb();
  const user = await db.users.findByEmail(session.email);
  // A signed cookie whose row is gone — deleted account, or a restored database.
  if (!user) return { res: json({ ok: false, error: "session_stale" }, 401) };
  return { db, userId: user.id };
}

/** Invalid entries are dropped, not rejected: a stale browser list must not 400 the sync. */
function symbols(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const entry of v) {
    if (typeof entry !== "string") continue;
    const sym = entry.toUpperCase();
    if (SYMBOL.test(sym) && !out.includes(sym)) out.push(sym);
  }
  return out.slice(0, MAX_PER_CALL);
}

function unavailable(e: unknown) {
  if (e instanceof DbUnavailableError) return json({ ok: false, error: "auth_not_configured" }, 501);
  console.error("[api/watchlist]", e);
  return json({ ok: false, error: "watchlist_unavailable" }, 502);
}

export async function GET() {
  try {
    const r = await resolveUser();
    if ("res" in r) return r.res;
    return json({ ok: true, data: { symbols: await r.db.watchlist.list(r.userId) } });
  } catch (e) {
    return unavailable(e);
  }
}

export async function PATCH(req: Request) {
  try {
    const r = await resolveUser();
    if ("res" in r) return r.res;

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return json({ ok: false, error: "invalid_body" }, 400);
    }
    const { add, remove } = (body ?? {}) as { add?: unknown; remove?: unknown };
    const toRemove = symbols(remove);
    const toAdd = symbols(add);

    // Removals first, so a call that swaps symbols at the cap still has room.
    if (toRemove.length) await r.db.watchlist.remove(r.userId, toRemove);
    if (toAdd.length) {
      const current = await r.db.watchlist.list(r.userId);
      const room = MAX_PER_USER - current.length;
      const fresh = toAdd.filter((s) => !current.includes(s)).slice(0, Math.max(room, 0));
      if (fresh.length) await r.db.watchlist.add(r.userId, fresh);
    }

    return json({ ok: true, data: { symbols: await r.db.watchlist.list(r.userId) } });
  } catch (e) {
    return unavailable(e);
  }
}
