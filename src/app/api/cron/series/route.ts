import { NextResponse } from "next/server";
import { dbAvailable, getDb } from "@/lib/db";
import { getGold } from "@/lib/providers/gold";
import { cronAuthorized } from "@/lib/retention/cron-auth";
import { recordGoldSeries } from "@/lib/retention/record-series";

export const runtime = "nodejs";
export const revalidate = 0;

/**
 * Record today's gold prices so a gold CHART can exist.
 *
 * A manual and testable entry point for the same work the daily cron does; the
 * rationale and the recording itself live in `retention/record-series.ts`,
 * because a fifth entry in vercel.json would risk the Hobby cron quota.
 */
export async function GET(req: Request) {
  const auth = cronAuthorized(req);
  if (auth === "not_configured" || !dbAvailable()) {
    return NextResponse.json({ ok: false, error: "not_configured" }, { status: 501 });
  }
  if (auth === "unauthorized") {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let snapshot;
  try {
    snapshot = await getGold();
  } catch {
    // A dead feed costs today's point, never the job.
    return NextResponse.json({ ok: false, error: "feed_unavailable" }, { status: 502 });
  }

  const db = await getDb();
  const result = await recordGoldSeries(db, snapshot, Date.now());
  return NextResponse.json({ ok: true, data: result });
}
