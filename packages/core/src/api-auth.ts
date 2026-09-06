/**
 * "Who is calling, and may they?" for routes that serve one reader's own data.
 *
 * Deliberately NOT in `api.ts`: this reads cookies, and `api.ts` is imported by
 * public, edge-cacheable routes purely for `ok()`. Pulling `next/headers` into
 * that module would drag session access into `/api/board` and friends and can
 * force a cacheable route to render dynamically.
 *
 * The order of the checks is the contract: unauthenticated before unentitled
 * before unconfigured, so a signed-out reader is never told to upgrade and an
 * unconfigured deployment never looks like a permission problem.
 */
import { NextResponse } from "next/server";
import { can, type Capability, type Tier } from "./auth/entitlement.ts";
import { getSession } from "./auth/session.ts";
import { dbAvailable, getDb, type Db } from "./db/index.ts";

/** Private by construction: one reader's rows must never reach a shared cache. */
export function priv(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

export type Resolved =
  | { res: NextResponse }
  | { db: Db; userId: string; email: string; tier: Tier };

export async function resolveUser(capability: Capability): Promise<Resolved> {
  const session = await getSession();
  if (!session?.email) return { res: priv({ ok: false, error: "unauthorized" }, 401) };

  if (!can(session.tier, capability)) {
    return { res: priv({ ok: false, error: "upgrade_required", tier: session.tier }, 402) };
  }
  if (!dbAvailable()) return { res: priv({ ok: false, error: "not_configured" }, 501) };

  const db = await getDb();
  const user = await db.users.findByEmail(session.email);
  // A validly signed cookie whose row is gone — a deleted account, or a database
  // restored from before the signup.
  if (!user) return { res: priv({ ok: false, error: "session_stale" }, 401) };

  return { db, userId: user.id, email: user.email, tier: session.tier };
}
