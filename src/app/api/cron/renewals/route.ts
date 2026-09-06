import { NextResponse } from "next/server";
import { dbAvailable, getDb, DbUnavailableError } from "@/lib/db";
import { atLeast } from "@/lib/auth/entitlement";
import { effectiveTier } from "@/lib/auth/provider";
import { sendEmail } from "@/lib/auth/mailer";
import { cronAuthorized } from "@/lib/retention/cron-auth";
import { renewalDue, renewalEmail } from "@/lib/retention/run";

export const runtime = "nodejs";
export const revalidate = 0;

/**
 * Renewal reminders — the churn guard for recurring revenue.
 *
 * A subscriber inside the final week before expiry is mailed once. The
 * reminded mark is set ONLY after the mail is actually sent (returns true) and
 * is cleared by `grant`, so a failure retries next run and a renewal re-arms
 * the reminder for the new term. A lapsed row (`effectiveTier` free) is skipped.
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

    let reminded = 0;
    for (const u of users) {
      const tier = effectiveTier(u, now);
      if (!atLeast(tier, "plus") || tier === "free") continue;
      if (!renewalDue(u.tierExpiresAt, u.renewalRemindedAt, now)) continue;
      const { subject, text } = renewalEmail(tier as "plus" | "pro", u.tierExpiresAt!, "vi");
      try {
        if (await sendEmail({ to: u.email, subject, text })) {
          await db.users.markRenewalReminded(u.email, now);
          reminded += 1;
        }
      } catch {
        /* leave the mark unset so the next run retries this reader */
      }
    }
    return NextResponse.json({ ok: true, data: { usersChecked: users.length, reminded } });
  } catch (err) {
    if (err instanceof DbUnavailableError) {
      return NextResponse.json({ ok: false, error: "cron_not_configured" }, { status: 501 });
    }
    throw err;
  }
}
