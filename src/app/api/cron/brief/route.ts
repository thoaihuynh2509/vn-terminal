import { NextResponse } from "next/server";
import { dbAvailable, getDb, DbUnavailableError } from "@/lib/db";
import { effectiveTier } from "@/lib/auth/provider";
import { atLeast } from "@/lib/auth/entitlement";
import { sendEmail } from "@/lib/auth/mailer";
import { buildBrief } from "@/lib/brief";
import { loadBriefInputs } from "@/lib/briefs/load";
import { composeSnapshot } from "@/lib/briefs/snapshot";
import { parseDay, tradingDay } from "@/lib/briefs/day";
import { cronAuthorized } from "@/lib/retention/cron-auth";
import { levelsNearPrice } from "@/lib/retention/levels";
import { parseDrawings } from "@/lib/chart/drawings";
import { briefEmail, personalNote } from "@/lib/retention/run";

export const runtime = "nodejs";
export const revalidate = 0;

/**
 * Daily brief email — a paid perk and a reason to return.
 *
 * Sent only to current subscribers (`effectiveTier` ≥ plus): a broadcast to
 * every signed-up address would need an explicit consent and unsubscribe flow,
 * which this does not yet have, so it stays scoped to people who bought a plan.
 * One dead feed degrades its own section of the brief, never the send.
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

    // The archive is written FIRST, and unconditionally.
    //
    // It used to be that with no paid subscribers this route returned before
    // fetching anything — correct when its only job was email. The snapshot is
    // not email: it is the day's public page, and a site with no subscribers
    // yet is exactly the site that most needs a year of indexable pages. It is
    // also why the mailer being unconfigured must not skip it.
    const inputs = await loadBriefInputs({ sparks: true });
    const day = parseDay(tradingDay(now.getTime()));
    let snapshot: string | null = null;
    if (day) {
      try {
        await db.briefs.put(day, composeSnapshot(day, inputs, now.getTime()), now);
        snapshot = day;
      } catch (e) {
        // A failed snapshot must not cost the subscribers their email.
        console.error("[cron/brief] snapshot failed", e);
      }
    }

    const recipients = (await db.users.all()).filter((u) => atLeast(effectiveTier(u, now), "plus"));
    if (recipients.length === 0) {
      return NextResponse.json({ ok: true, data: { recipients: 0, emailed: 0, snapshot } });
    }

    // Emails default to Vietnamese, the primary audience; a stored per-user
    // locale would drive this once the account carries one.
    const board = inputs.board;
    const brief = buildBrief("vi", inputs);
    const { subject, text } = briefEmail(brief, "vi");

    // The market summary above is identical for everyone. What follows is not:
    // each subscriber's own watchlist, alerts and drawn levels are what make
    // this worth opening, and what makes it a reason to go back to the chart.
    const quotes = new Map(board.map((q) => [q.symbol.toUpperCase(), q]));
    const nowSec = Math.floor(now.getTime() / 1000);

    let emailed = 0;
    let personalised = 0;
    for (const u of recipients) {
      let body = text;
      try {
        const [watch, alerts, drawingDocs] = await Promise.all([
          db.watchlist.list(u.id),
          db.alerts.list(u.id),
          db.docs.list(u.id, "drawings"),
        ]);

        const movers = watch
          .map((sym) => quotes.get(sym.toUpperCase()))
          .filter((q): q is NonNullable<typeof q> => !!q)
          .map((q) => ({ symbol: q.symbol, changePct: q.changePct }))
          .sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct));

        const levels = drawingDocs.flatMap((doc) => {
          const q = quotes.get(doc.key.toUpperCase());
          if (!q) return [];
          // Stored as opaque JSON, so it is parsed through the same tolerant
          // reader the browser uses rather than trusted as a shape.
          return levelsNearPrice(doc.key, parseDrawings(JSON.stringify(doc.data)), q.price, nowSec);
        });

        const note = personalNote("vi", {
          movers,
          fired: alerts.filter((a) => a.triggeredAt),
          levels,
        });
        if (note) {
          body = `${text}\n${note}\n`;
          personalised += 1;
        }
      } catch {
        // A reader whose personal data cannot be read still gets the market
        // brief — the section is an addition, never a precondition.
      }

      try {
        if (await sendEmail({ to: u.email, subject, text: body })) emailed += 1;
      } catch {
        /* one failure must not abort the batch */
      }
    }
    return NextResponse.json({ ok: true, data: { recipients: recipients.length, emailed, personalised, snapshot } });
  } catch (err) {
    if (err instanceof DbUnavailableError) {
      return NextResponse.json({ ok: false, error: "cron_not_configured" }, { status: 501 });
    }
    throw err;
  }
}
