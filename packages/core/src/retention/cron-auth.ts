/**
 * Cron authorization.
 *
 * Vercel Cron sends `Authorization: Bearer $CRON_SECRET` on every scheduled
 * request when CRON_SECRET is set. With no secret configured the endpoint is
 * "not configured" (501) rather than open — a delivery job that emails readers
 * must never be triggerable by an anonymous GET.
 */
export type CronAuth = "ok" | "unauthorized" | "not_configured";

export function cronAuthorized(req: Request): CronAuth {
  const secret = process.env.CRON_SECRET;
  if (!secret) return "not_configured";
  return req.headers.get("authorization") === `Bearer ${secret}` ? "ok" : "unauthorized";
}
