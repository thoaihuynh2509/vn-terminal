import { NextResponse } from "next/server";

/**
 * One response envelope for every route so the client never has to guess.
 * `stale` tells the UI to show the degraded banner while still rendering data.
 */
export function ok<T>(data: T, sMaxAge = 60) {
  return NextResponse.json(
    { ok: true as const, data, at: new Date().toISOString() },
    { headers: { "Cache-Control": `public, s-maxage=${sMaxAge}, stale-while-revalidate=${sMaxAge * 5}` } },
  );
}

/**
 * Same envelope, but never shared. Use for a response whose contents depend on
 * the reader's tier/session: a `public` cache keyed on the URL alone would let
 * one entitled request populate the edge and serve the paid payload to everyone
 * after it. `private, no-store` keeps a gated response off the shared cache.
 */
export function okPrivate<T>(data: T) {
  return NextResponse.json(
    { ok: true as const, data, at: new Date().toISOString() },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

export function fail(err: unknown, status = 502) {
  const message = err instanceof Error ? err.message : "unknown error";
  // Upstream detail is safe here (public endpoints, no credentials) and makes
  // a broken feed diagnosable from the network tab.
  return NextResponse.json({ ok: false as const, error: message }, { status });
}
