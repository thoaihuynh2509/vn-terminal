import { NextResponse } from "next/server";
import { ask } from "@/lib/ask/provider";
import { fail } from "@/lib/api";
import { getSession, encodeSession, cookieOptions, sessionsAvailable, SESSION_COOKIE } from "@/lib/auth/session";
import { FREE_ASK_LIMIT, freeAsksLeft } from "@/lib/ask/meter";
import { clientIp } from "@/lib/rate-limit";

export const revalidate = 0;
// The Anthropic SDK and the market providers both need Node APIs.
export const runtime = "nodejs";

const MAX_QUESTION_CHARS = 500;

/**
 * Per-IP rate limit.
 *
 * An unauthenticated endpoint that can reach a paid model is an obvious abuse
 * target, so it is capped even while the mock is the default provider — the
 * limit must already be in place on the day someone flips ASK_PROVIDER=claude.
 * In-memory, so it is per-instance: adequate for a single node, and the seam to
 * replace with a shared store if this ever runs on more than one.
 */
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 8;
const hits = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear(); // crude bound; this is not a session store
  return recent.length > MAX_PER_WINDOW;
}

export async function POST(req: Request) {
  if (rateLimited(clientIp(req))) {
    return NextResponse.json(
      { ok: false as const, error: "rate_limited" },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  }

  // Entitlement before any work. This endpoint is the only one whose cost
  // scales with use, so it is gated first — before parsing, before touching a
  // feed, and long before a token is spent with the model.
  const session = await getSession();
  const tier = session?.tier ?? "anon";
  // One arithmetic for the count the reader is shown and the count enforced
  // here; see `ask/meter.ts` for why those must not be two implementations.
  const left = freeAsksLeft(tier, session?.asks, sessionsAvailable());
  const entitled = left === null;
  const teaser = left !== null && left > 0;
  if (!entitled && !teaser) {
    return NextResponse.json(
      { ok: false as const, error: "upgrade_required", tier },
      { status: 402 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail(new Error("invalid JSON body"), 400);
  }

  const { question, locale, symbol } = (body ?? {}) as { question?: unknown; locale?: unknown; symbol?: unknown };

  if (typeof question !== "string" || !question.trim()) {
    return fail(new Error("question is required"), 400);
  }
  if (question.length > MAX_QUESTION_CHARS) {
    return fail(new Error(`question exceeds ${MAX_QUESTION_CHARS} characters`), 400);
  }

  const loc = locale === "en" ? "en" : "vi";

  try {
    const focus = typeof symbol === "string" ? symbol.toUpperCase().slice(0, 8) : undefined;
    const result = await ask(question.trim(), loc, focus);
    const remaining = teaser ? left - 1 : undefined;
    const res = NextResponse.json({ ok: true as const, data: { ...result, ...(remaining !== undefined ? { freeRemaining: remaining } : {}) } });
    if (teaser) {
      // Spend one free ask. Reuse the reader's session (or mint an anon meter
      // one) so the count persists exactly like the free-article meter.
      const next = {
        email: session?.email ?? "",
        tier: session?.tier ?? ("anon" as const),
        read: session?.read ?? [],
        iat: session?.iat ?? Math.floor(Date.now() / 1000),
        // Derived from the clamped remainder rather than from the stored count,
        // so a corrupt `asks` is healed by the next ask instead of persisted.
        asks: FREE_ASK_LIMIT - (left - 1),
        ...(session?.exp !== undefined ? { exp: session.exp } : {}),
      };
      res.cookies.set(SESSION_COOKIE, await encodeSession(next), cookieOptions());
    }
    return res;
  } catch (e) {
    // Never leak provider internals (keys, org ids) to the client.
    console.error("[api/ask]", e);
    return NextResponse.json({ ok: false as const, error: "assistant_unavailable" }, { status: 502 });
  }
}
