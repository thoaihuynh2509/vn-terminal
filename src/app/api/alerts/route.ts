import { priv, resolveUser } from "@/lib/api-auth";
import { ALERT_LIMIT } from "@/lib/auth/entitlement";
import { sanitizeAlerts } from "@/lib/alerts/alerts";
import { DbUnavailableError } from "@/lib/db";

export const runtime = "nodejs";
export const revalidate = 0;

/**
 * The reader's price alerts, server-side.
 *
 * This route is the piece that was missing: the `alerts` table and the nightly
 * `/api/cron/alerts` job both existed, but nothing ever wrote to the table, so
 * the cron always evaluated an empty set and the paid "we'll email you" promise
 * could never fire for anyone. Alerts only become real once they are stored
 * somewhere the tab being closed does not erase.
 *
 * Gated on `sync:docs`, the same capability that carries saved drawings across
 * devices. Free alerts stay in the browser and fire in the open tab, so this
 * route never sees them — which is also defence in depth for the cron, whose
 * input is then exactly the set of readers entitled to be emailed.
 *
 * Replace-all rather than per-alert edits: the browser already owns the whole
 * list, `db.alerts.replace` is a single transaction, and a partial-update API
 * would invite two devices into an interleaving neither of them expects.
 */
function unavailable(e: unknown) {
  if (e instanceof DbUnavailableError) return priv({ ok: false, error: "not_configured" }, 501);
  console.error("[api/alerts]", e);
  return priv({ ok: false, error: "alerts_unavailable" }, 502);
}

export async function GET() {
  try {
    const r = await resolveUser("sync:docs");
    if ("res" in r) return r.res;
    return priv({ ok: true, data: await r.db.alerts.list(r.userId) });
  } catch (e) {
    return unavailable(e);
  }
}

export async function PUT(req: Request) {
  try {
    const r = await resolveUser("sync:docs");
    if ("res" in r) return r.res;

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return priv({ ok: false, error: "invalid_body" }, 400);
    }

    // Trimmed, not rejected, when over the ceiling: a reader who downgrades
    // still has a list, and refusing every write would strand it uneditable.
    const limit = ALERT_LIMIT[r.tier];
    const alerts = sanitizeAlerts((body as { alerts?: unknown } | null)?.alerts).slice(0, limit);

    await r.db.alerts.replace(r.userId, alerts);
    return priv({ ok: true, data: alerts });
  } catch (e) {
    return unavailable(e);
  }
}
