import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { isAdmin } from "@/lib/auth/admin";
import { sameOrigin } from "@/lib/auth/same-origin";
import { dbAvailable, getDb, DbUnavailableError } from "@/lib/db";
import { grantForOrder } from "@/lib/billing/settle";

export const runtime = "nodejs";
export const revalidate = 0;

/**
 * Manual payment confirmation — the owner marks a pending order paid after
 * eyeballing the transfer in their MoMo/bank app. Admin-only (the same
 * ADMIN_EMAILS gate as /admin), and it routes through `grantForOrder`, so it is
 * idempotent and grants the tier + credits any referrer exactly like an IPN.
 */
export async function POST(req: Request) {
  const session = await getSession();
  // One 404 for both: never reveal the endpoint to a non-admin, and never tell
  // a prober which of the two checks their request tripped.
  if (!sameOrigin(req) || !isAdmin(session?.email)) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }
  if (!dbAvailable()) {
    return NextResponse.json({ ok: false, error: "db_unavailable" }, { status: 501 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 400 });
  }
  const orderId = (body as { orderId?: unknown })?.orderId;
  if (typeof orderId !== "string" || !orderId) {
    return NextResponse.json({ ok: false, error: "missing_order" }, { status: 400 });
  }

  try {
    const db = await getDb();
    const order = await db.orders.get(orderId);
    if (!order) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
    const result = await grantForOrder(db, order, `manual:${session!.email}`, new Date());
    return NextResponse.json({ ok: true, data: { result } }); // "granted" or "already"
  } catch (err) {
    if (err instanceof DbUnavailableError) {
      return NextResponse.json({ ok: false, error: "db_unavailable" }, { status: 501 });
    }
    throw err;
  }
}
