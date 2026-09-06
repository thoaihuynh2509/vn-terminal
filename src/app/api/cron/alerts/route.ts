import { NextResponse } from "next/server";
import { dbAvailable, getDb, DbUnavailableError } from "@/lib/db";
import { can } from "@/lib/auth/entitlement";
import { effectiveTier } from "@/lib/auth/provider";
import { sendEmail } from "@/lib/auth/mailer";
import { getBoard } from "@/lib/providers/vnstock";
import { cronAuthorized } from "@/lib/retention/cron-auth";
import { alertEmail, alertSymbols, runUserAlerts, type QuoteLite } from "@/lib/retention/run";

export const runtime = "nodejs";
export const revalidate = 0;

/**
 * Server-side price-alert delivery. This is the retention hook the product was
 * missing: an alert reaches a subscriber whose tab is closed.
 *
 * Only readers whose CURRENT entitlement includes alerts are evaluated —
 * `effectiveTier` applies the same expiry downgrade the session cookie applies,
 * so a lapsed subscriber stops getting the paid feature. A fired alert is
 * persisted as triggered BEFORE the mail is a concern, and `shouldFire` is one
 * shot, so a re-run cannot double-send.
 */
export async function GET(req: Request) {
  const auth = cronAuthorized(req);
  if (auth === "not_configured" || !dbAvailable()) {
    return NextResponse.json({ ok: false, error: "cron_not_configured" }, { status: 501 });
  }
  if (auth === "unauthorized") {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  try {
    const db = await getDb();
    const now = new Date();
    const users = await db.users.all();

    const pending: { id: string; email: string; alerts: Awaited<ReturnType<typeof db.alerts.list>> }[] = [];
    const symbols = new Set<string>();
    for (const u of users) {
      if (!can(effectiveTier(u, now), "alerts:create")) continue;
      const alerts = await db.alerts.list(u.id);
      if (!alerts.some((a) => !a.triggeredAt)) continue;
      pending.push({ id: u.id, email: u.email, alerts });
      for (const s of alertSymbols(alerts)) symbols.add(s);
    }

    let fired = 0;
    let emailed = 0;
    if (symbols.size > 0) {
      const board = await getBoard([...symbols]);
      const quotes = new Map<string, QuoteLite>(
        board.map((q) => [q.symbol.toUpperCase(), { symbol: q.symbol, price: q.price, prevClose: q.prevClose }]),
      );
      for (const p of pending) {
        const run = runUserAlerts(p.alerts, quotes, now.getTime());
        if (run.fired.length === 0) continue;
        await db.alerts.replace(p.id, run.next); // persist the one-shot flag first
        fired += run.fired.length;
        const { subject, text } = alertEmail(run.fired, quotes, "vi");
        try {
          if (await sendEmail({ to: p.email, subject, text })) emailed += 1;
        } catch {
          /* one reader's mail failure must not abort the batch */
        }
      }
    }

    return NextResponse.json({ ok: true, data: { usersChecked: pending.length, fired, emailed } });
  } catch (err) {
    if (err instanceof DbUnavailableError) {
      return NextResponse.json({ ok: false, error: "cron_not_configured" }, { status: 501 });
    }
    throw err;
  }
}
