import { NextResponse } from "next/server";
import { dbAvailable, getDb, DbUnavailableError } from "@/lib/db";
import { authorizeWebhook, matchesOrder, providerRef, sepayConfig, type SepayEvent } from "@/lib/billing/sepay";
import { grantForOrder } from "@/lib/billing/settle";

export const runtime = "nodejs";
export const revalidate = 0;

/**
 * SePay's incoming-transfer webhook. The transfer memo carries the order id and
 * the header carries the shared API key.
 *
 * Auth the header, parse the event, find the order named in the memo, confirm
 * the amount, then settle idempotently. A transfer whose memo names no order is
 * acknowledged (200) but grants nothing — an unrelated deposit into the same
 * account must not error and must not be retried forever.
 */
export async function POST(req: Request) {
  const cfg = sepayConfig();
  if (!cfg || !dbAvailable()) {
    return NextResponse.json({ ok: false, error: "not_configured" }, { status: 501 });
  }
  if (!authorizeWebhook(cfg, req.headers.get("authorization"))) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let ev: SepayEvent;
  try {
    ev = (await req.json()) as SepayEvent;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 400 });
  }

  try {
    const db = await getDb();
    // The memo is the order id we asked the payer to include; pull the longest
    // vnt- token out of it and look that order up.
    const memo = (ev.content ?? "").toUpperCase();
    const idMatch = memo.match(/VNT-[0-9A-F-]+/i);
    const order = idMatch ? await db.orders.get(idMatch[0].toLowerCase()) : null;
    if (!order || !matchesOrder(ev, order)) {
      return NextResponse.json({ ok: true, matched: false }); // ack, grant nothing
    }
    await grantForOrder(db, order, providerRef(ev), new Date());
    return NextResponse.json({ ok: true, matched: true });
  } catch (err) {
    if (err instanceof DbUnavailableError) {
      return NextResponse.json({ ok: false, error: "not_configured" }, { status: 501 });
    }
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}
