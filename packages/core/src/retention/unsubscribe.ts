/**
 * Unsubscribe tokens.
 *
 * Every teaser carries a one-click unsubscribe that must work WITHOUT a login —
 * a reader who no longer wants mail cannot be asked to sign in first. The token
 * is an HMAC of the address, so it is unguessable and reveals nothing, and it
 * only ever flips a marketing flag: even if leaked, the worst it can do is
 * unsubscribe that one address, which is the reader's own right anyway.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

function secret(): string | null {
  const s = process.env.AUTH_SECRET;
  if (s && s.length >= 32) return s;
  if (!s && process.env.NODE_ENV !== "production") return "dev-only-insecure-secret-do-not-use-in-production";
  return null;
}

export function unsubToken(email: string): string | null {
  const key = secret();
  if (!key) return null;
  return createHmac("sha256", key).update(`unsub:${email.toLowerCase()}`, "utf8").digest("hex");
}

export function verifyUnsub(email: string, token: string | null | undefined): boolean {
  const expected = unsubToken(email);
  if (!expected || !token) return false;
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(token, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
