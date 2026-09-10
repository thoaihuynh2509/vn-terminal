/**
 * The same-origin gate every state-changing POST is held to.
 *
 * SameSite=lax is not the whole defence: it still lets a top-level form POST
 * through, and `req.json()` rejecting a form-encoded body is an accident of
 * parsing, not a check. So the request has to say where it came from.
 *
 * Every current browser sends Sec-Fetch-Site; the clients that do not (Safari
 * before 16.4, old webviews) still send Origin on a form POST, so they must
 * prove same-origin with it. A POST carrying neither is not a browser we can
 * vouch for. Server-to-server callers send neither either, which is why the
 * provider webhooks authenticate by signature instead and are NOT gated here.
 */
import { linkOrigin } from "./magic.ts";

/** Canonical origin first — a poisoned Host must not decide what counts as ours. */
function canonicalOrigin(req: Request): string {
  return linkOrigin() ?? new URL(req.url).origin;
}

export function sameOrigin(req: Request): boolean {
  const site = req.headers.get("sec-fetch-site");
  if (site === null) return req.headers.get("origin") === canonicalOrigin(req);
  return site === "same-origin" || site === "none";
}
