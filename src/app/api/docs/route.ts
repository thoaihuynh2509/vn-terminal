import { priv, resolveUser } from "@/lib/api-auth";
import { DbUnavailableError } from "@/lib/db";
import { SETUP_KINDS, isDocKind, statusFor, validateDoc } from "@/lib/docs";

export const runtime = "nodejs";
export const revalidate = 0;

/**
 * Saved chart artifacts — drawings, layouts, indicator templates, settings.
 *
 * Every method requires `sync:docs`, which only paid tiers hold. That is the
 * whole shape of the free tier's deal: free readers keep their work, but it
 * lives in their browser and never reaches this route. So the caps enforced here
 * are the paid ones; the free ceiling is applied client-side, from the same
 * constants, and nothing free ever gets this far.
 *
 * Responses are `private, no-store` — these are one reader's rows.
 */
function unavailable(e: unknown) {
  if (e instanceof DbUnavailableError) return priv({ ok: false, error: "not_configured" }, 501);
  console.error("[api/docs]", e);
  return priv({ ok: false, error: "docs_unavailable" }, 502);
}

export async function GET(req: Request) {
  try {
    const r = await resolveUser("sync:docs");
    if ("res" in r) return r.res;

    const p = new URL(req.url).searchParams;
    const kind = p.get("kind");
    if (!isDocKind(kind)) return priv({ ok: false, error: "unknown_kind" }, 400);

    const key = p.get("key");
    if (key) {
      const doc = await r.db.docs.get(r.userId, kind, key);
      return priv({ ok: true, data: doc });
    }
    return priv({ ok: true, data: await r.db.docs.list(r.userId, kind) });
  } catch (e) {
    return unavailable(e);
  }
}

export async function PUT(req: Request) {
  try {
    const r = await resolveUser("sync:docs");
    if ("res" in r) return r.res;

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return priv({ ok: false, error: "invalid_body" }, 400);
    }
    const { kind, key, data, version } = (body ?? {}) as {
      kind?: unknown; key?: unknown; data?: unknown; version?: unknown;
    };
    if (!isDocKind(kind) || typeof key !== "string") {
      return priv({ ok: false, error: "unknown_kind" }, 400);
    }

    // Saved setups share one budget across kinds, and the count must exclude the
    // key being overwritten or the last slot would become read-only.
    let setupCount = 0;
    if (SETUP_KINDS.includes(kind)) {
      const existing = await Promise.all(SETUP_KINDS.map((k) => r.db.docs.list(r.userId, k)));
      setupCount = existing.flat().filter((d) => !(d.kind === kind && d.key === key)).length;
    }

    const check = validateDoc(kind, key, data, { tier: r.tier, setupCount });
    if (!check.ok) {
      return priv({ ok: false, error: check.error, limit: check.limit }, statusFor(check.error!));
    }

    const saved = await r.db.docs.put(
      r.userId, kind, key, data, new Date(),
      typeof version === "number" ? version : undefined,
    );
    // A refused write is not an error: the caller is handed the row that won so
    // it can merge, which is the whole point of carrying a version.
    return priv({ ok: true, data: { saved: saved.saved, doc: saved.doc } }, saved.saved ? 200 : 409);
  } catch (e) {
    return unavailable(e);
  }
}

export async function DELETE(req: Request) {
  try {
    const r = await resolveUser("sync:docs");
    if ("res" in r) return r.res;

    const p = new URL(req.url).searchParams;
    const kind = p.get("kind");
    const key = p.get("key");
    if (!isDocKind(kind) || !key) return priv({ ok: false, error: "unknown_kind" }, 400);

    await r.db.docs.remove(r.userId, kind, key);
    return priv({ ok: true, data: null });
  } catch (e) {
    return unavailable(e);
  }
}
