import { NextResponse } from "next/server";
import { dbAvailable, getDb, DbUnavailableError } from "@/lib/db";
import { isPaid, momoConfig, verifyIpn, type IpnFields } from "@/lib/billing/momo";
import { grantForOrder } from "@/lib/billing/settle";

export const runtime = "nodejs";
export const revalidate = 0;

/**
 * MoMo's server-to-server payment notification. This is the ONLY place a tier
 * is granted from a payment — the browser redirect is never trusted.
 *
 * Order of checks is the security: verify the signature before reading any
 * field as truth, match the amount against the order we wrote, then flip the
 * order pending→paid ATOMICALLY. The flip is the idempotency lock — a replayed
 * IPN updates zero rows and grants nothing, so double-crediting is impossible.
 * MoMo retries until it gets a 2xx, so a transient DB error must NOT 2xx.
 */
export async function POST(req: Request) {
  const cfg = momoConfig();
  if (!cfg || !dbAvailable()) {
    return NextResponse.json({ error: "billing_not_configured" }, { status: 501 });
  }

  let f: IpnFields;
  try {
    f = (await req.json()) as IpnFields;
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  if (!verifyIpn(cfg, f)) {
    return NextResponse.json({ error: "bad_signature" }, { status: 400 });
  }

  try {
    const db = await getDb();
    const order = await db.orders.get(f.orderId);
    if (!order) return NextResponse.json({ error: "unknown_order" }, { status: 404 });

    // A signed notification for the wrong amount is a tampered or mis-routed
    // payment; never grant on it.
    if (f.amount !== order.amount) {
      return NextResponse.json({ error: "amount_mismatch" }, { status: 400 });
    }

    if (!isPaid(f)) {
      // A genuine non-success (user cancelled, timed out). Acknowledge so MoMo
      // stops retrying; the order stays pending and grants nothing. 204 carries
      // no body by spec — MoMo only needs the 2xx.
      return new NextResponse(null, { status: 204 });
    }

    await grantForOrder(db, order, String(f.transId), new Date());
    // Whether we just granted or this is a replay, the notification is handled.
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    if (err instanceof DbUnavailableError) {
      return NextResponse.json({ error: "billing_not_configured" }, { status: 501 });
    }
    // Do NOT swallow into a 2xx: MoMo must retry so the payment is not lost.
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
