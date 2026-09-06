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

export function fail(err: unknown, status = 502) {
  const message = err instanceof Error ? err.message : "unknown error";
  // Upstream detail is safe here (public endpoints, no credentials) and makes
  // a broken feed diagnosable from the network tab.
  return NextResponse.json({ ok: false as const, error: message }, { status });
}
