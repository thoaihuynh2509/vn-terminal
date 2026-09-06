import { NextResponse } from "next/server";
import { dbAvailable, getDb, DbUnavailableError } from "@/lib/db";
import { effectiveTier } from "@/lib/auth/provider";
import { sendEmail } from "@/lib/auth/mailer";
import { PATHS } from "@/lib/i18n";
import { cronAuthorized } from "@/lib/retention/cron-auth";
import { teaserEmail } from "@/lib/retention/run";
import { unsubToken } from "@/lib/retention/unsubscribe";

export const runtime = "nodejs";
export const revalidate = 0;

const WEEK_MS = 7 * 86_400_000;

/**
 * Weekly teaser to signed-up FREE readers — the growth nudge toward a paid plan.
 *
 * Consent-respecting by construction: a reader who has opted out is skipped, a
 * reader mailed within the last ~week is skipped (so it is weekly, not every
 * run), and every email carries a one-click unsubscribe. Paid readers are never
 * teased. Needs NEXT_PUBLIC_SITE_URL for the links.
 */
export async function GET(req: Request) {
  const auth = cronAuthorized(req);
  const site = process.env.NEXT_PUBLIC_SITE_URL;
  if (auth === "not_configured" || !dbAvailable() || !site) {
    return NextResponse.json({ ok: false, error: "cron_not_configured" }, { status: 501 });
  }
  if (auth === "unauthorized") {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  try {
    const db = await getDb();
    const now = new Date();
    const users = await db.users.all();

    let sent = 0;
    for (const u of users) {
      if (effectiveTier(u, now) !== "free") continue; // only nudge non-payers
      if (u.marketingOptOut) continue;
      if (u.teaserSentAt && now.getTime() - u.teaserSentAt.getTime() < WEEK_MS) continue;
      const token = unsubToken(u.email);
      if (!token) break; // no signing secret: cannot mint an unsubscribe link, so send nothing
      const { subject, text } = teaserEmail("vi", {
        pricingUrl: `${site}/vi/${PATHS.pricing.vi}`,
        unsubUrl: `${site}/api/unsubscribe?email=${encodeURIComponent(u.email)}&token=${token}`,
      });
      try {
        if (await sendEmail({ to: u.email, subject, text })) {
          await db.users.markTeaserSent(u.email, now);
          sent += 1;
        }
      } catch {
        /* one reader's failure must not abort the batch */
      }
    }
    return NextResponse.json({ ok: true, data: { usersChecked: users.length, sent } });
  } catch (err) {
    if (err instanceof DbUnavailableError) {
      return NextResponse.json({ ok: false, error: "cron_not_configured" }, { status: 501 });
    }
    throw err;
  }
}
