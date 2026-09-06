/**
 * Canonical site origin for metadata, robots and sitemap.
 *
 * `process.env.NEXT_PUBLIC_SITE_URL ?? default` is a trap: `??` only falls back
 * on undefined/null, so an env var set to an EMPTY string (a common Vercel
 * misconfiguration) yields "" — and `new URL("")` throws `ERR_INVALID_URL`
 * inside `generateMetadata`, which surfaces as React #441 and takes down every
 * route via the error boundary. Resolve defensively instead: treat empty,
 * whitespace, or an unparseable value as "unset" and fall back to the
 * production origin, so a bad env var can never crash a render.
 */
const DEFAULT_SITE_URL = "https://vn-terminal.vercel.app";

export function siteUrl(): string {
  const raw = (process.env.NEXT_PUBLIC_SITE_URL || "").trim().replace(/\/+$/, "");
  if (!raw) return DEFAULT_SITE_URL;
  try {
    new URL(raw);
    return raw;
  } catch {
    return DEFAULT_SITE_URL;
  }
}
