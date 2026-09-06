import { cookies } from "next/headers";
import { decodeSession, SESSION_COOKIE, type Session } from "./token";
import type { Tier } from "./entitlement";

/**
 * Cookie-jar bound helpers. All signing/verification lives in ./token so it can
 * be tested without a Next request context.
 */

/** Server-side read of the current session. Returns null when signed out. */
export async function getSession(): Promise<Session | null> {
  const jar = await cookies();
  return decodeSession(jar.get(SESSION_COOKIE)?.value);
}

/** The reader's tier — `anon` when signed out. Always derive gates from this. */
export async function getTier(): Promise<Tier> {
  return (await getSession())?.tier ?? "anon";
}

export { encodeSession, decodeSession, cookieOptions, sessionsAvailable, SESSION_COOKIE, SESSION_MAX_AGE } from "./token";
export type { Session } from "./token";
