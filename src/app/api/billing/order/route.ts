import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { dbAvailable, getDb, DbUnavailableError } from "@/lib/db";

export const runtime = "nodejs";
export const revalidate = 0;

/**
 * Status of one order, for the return page to poll until the IPN lands.
 *
 * Scoped to the caller's own order — the id is a UUID, but ownership is still
 * checked so an order id in a log or URL cannot reveal another reader's
 * purchase. Read-only; it never grants anything.
 */
export async function GET(req: Request) {
  const session = await getSession();
  if (!session?.email) {
    return NextResponse.json({ ok: false, error: "sign_in_required" }, { status: 401 });
  }
  if (!dbAvailable()) {
    return NextResponse.json({ ok: false, error: "billing_not_configured" }, { status: 501 });
  }

  const id = new URL(req.url).searchParams.get("order");
  if (!id) return NextResponse.json({ ok: false, error: "missing_order" }, { status: 400 });

  try {
    const db = await getDb();
    const order = await db.orders.get(id);
    if (!order || order.email !== session.email) {
      return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
    }
    return NextResponse.json(
      { ok: true, data: { status: order.status, tier: order.tier, plan: order.plan } },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (err) {
    if (err instanceof DbUnavailableError) {
      return NextResponse.json({ ok: false, error: "billing_not_configured" }, { status: 501 });
    }
    throw err;
  }
}
