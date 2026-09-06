import { NextResponse } from "next/server";
import { dbAvailable, getDb, DbUnavailableError } from "@/lib/db";
import { isPaid, verifyReturn, vnpayConfig } from "@/lib/billing/vnpay";
import { grantForOrder } from "@/lib/billing/settle";

export const runtime = "nodejs";
export const revalidate = 0;

/**
 * VNPay's server-to-server IPN (a GET with `vnp_` query params).
 *
 * Verify the secure hash before trusting any field, match the amount against
 * our order, then settle idempotently. VNPay expects a specific JSON ack shape:
 * `{ RspCode, Message }` — `00` means "recorded", and any hash/amount mismatch
 * gets its own documented code so their dashboard shows why nothing was granted.
 */
export async function GET(req: Request) {
  const cfg = vnpayConfig();
  if (!cfg || !dbAvailable()) {
    return NextResponse.json({ RspCode: "99", Message: "not configured" }, { status: 200 });
  }

  const params = Object.fromEntries(new URL(req.url).searchParams.entries());
  if (!verifyReturn(cfg, params)) {
    return NextResponse.json({ RspCode: "97", Message: "Invalid signature" }, { status: 200 });
  }

  try {
    const db = await getDb();
    const order = await db.orders.get(params.vnp_TxnRef ?? "");
    if (!order) return NextResponse.json({ RspCode: "01", Message: "Order not found" });
    if (Number(params.vnp_Amount) !== order.amount * 100) {
      return NextResponse.json({ RspCode: "04", Message: "Invalid amount" });
    }
    if (isPaid(params)) {
      await grantForOrder(db, order, params.vnp_TransactionNo ?? "vnpay", new Date());
    }
    // Acknowledge either way so VNPay stops retrying a settled/decided order.
    return NextResponse.json({ RspCode: "00", Message: "Confirm Success" });
  } catch (err) {
    if (err instanceof DbUnavailableError) {
      return NextResponse.json({ RspCode: "99", Message: "not configured" });
    }
    // Not a 2xx-with-00: an unhandled error must let VNPay retry.
    return NextResponse.json({ RspCode: "99", Message: "server error" }, { status: 500 });
  }
}
