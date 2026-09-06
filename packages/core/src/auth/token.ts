import { TIER_ORDER, type Tier } from "./entitlement.ts";

const TIERS: readonly Tier[] = TIER_ORDER;

/**
 * Session token codec — signing, verification and encoding.
 *
 * Split out of session.ts so it imports nothing from `next/headers` and can be
 * unit tested directly. session.ts keeps only the cookie-jar helpers.
 */
const COOKIE = "vnt_session";
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

export interface Session {
  email: string;
  tier: Tier;
  /** Slugs of member articles already counted against the free meter. */
  read: string[];
  iat: number;
  /**
   * Subscription end (unix seconds). Absent for anonymous/free sessions and for
   * a comped tier with no end. When present and past, the tier is served as
   * `free`: a paid session self-downgrades at this one chokepoint every reader
   * already passes through, with no per-request database read.
   */
  exp?: number;
  /**
   * Free AI asks already spent by a non-entitled reader. The teaser meter that
   * lets a visitor try the assistant a couple of times before the paywall — the
   * count lives in the signed cookie so it cannot be edited, same as `read`.
   */
  asks?: number;
}

/**
 * The signing secret, or null when sessions are unavailable.
 *
 * In production a missing AUTH_SECRET means "no sessions" — everyone is
 * anonymous — NOT a crash. An earlier version threw here, and because the
 * layout resolves the session on every request that turned a missing env var
 * into a site-wide 500. Failing closed on auth must not fail the whole site.
 */
function secret(): string | null {
  const s = process.env.AUTH_SECRET;
  if (!s) {
    if (process.env.NODE_ENV === "production") return null;
    return "dev-only-insecure-secret-do-not-use-in-production";
  }
  if (s.length < 32) {
    if (process.env.NODE_ENV === "production") return null;
    throw new Error("AUTH_SECRET must be at least 32 characters");
  }
  return s;
}

/** Whether signed sessions can be issued or verified at all. */
export function sessionsAvailable(): boolean {
  return secret() !== null;
}

const b64url = (buf: ArrayBuffer | Uint8Array) => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return Buffer.from(bytes).toString("base64url");
};

async function key(): Promise<CryptoKey | null> {
  const s = secret();
  if (!s) return null;
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(s),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function sign(payload: string): Promise<string | null> {
  const k = await key();
  if (!k) return null;
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(payload));
  return b64url(sig);
}

/** Constant-time compare so signature checking cannot be timed. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function encodeSession(s: Session): Promise<string> {
  const payload = Buffer.from(JSON.stringify(s)).toString("base64url");
  const sig = await sign(payload);
  if (!sig) throw new Error("cannot issue a session without AUTH_SECRET");
  return `${payload}.${sig}`;
}

export async function decodeSession(token: string | undefined): Promise<Session | null> {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = await sign(payload);
  if (!expected) return null; // sessions unavailable → treat everyone as anonymous
  if (!safeEqual(sig, expected)) return null; // tampered or wrong secret
  try {
    const s = JSON.parse(Buffer.from(payload, "base64url").toString()) as Session;
    // An anonymous metered session has an EMPTY email — it exists only to carry
    // the meter. Requiring an email here silently discarded those cookies, so
    // signed-out readers got unlimited member articles. Validate the tier, which
    // is the field gates actually read.
    if (!s || typeof s.email !== "string") return null;
    if (!TIERS.includes(s.tier)) return null;
    if (Date.now() / 1000 - s.iat > MAX_AGE) return null; // cookie expired
    const read = Array.isArray(s.read) ? s.read : [];
    // A paid tier past its subscription end is served as free. The signed row is
    // still the truth for renewals; the cookie is a snapshot that expires itself.
    const exp = typeof s.exp === "number" ? s.exp : undefined;
    const tier = exp !== undefined && Date.now() / 1000 > exp ? "free" : s.tier;
    const asks = typeof s.asks === "number" && s.asks >= 0 ? s.asks : undefined;
    return { ...s, tier, read, ...(exp !== undefined ? { exp } : {}), ...(asks !== undefined ? { asks } : {}) };
  } catch {
    return null;
  }
}

export const SESSION_COOKIE = COOKIE;
export const SESSION_MAX_AGE = MAX_AGE;

export function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE,
  };
}
