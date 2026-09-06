/**
 * Magic-link primitives: minting, hashing and redirect validation.
 *
 * The raw token lives only in the email and in the URL the reader clicks. Only
 * its SHA-256 is ever persisted, so a leaked database yields no usable links.
 */
import type { Locale } from "../types.ts";
import { PATHS } from "../i18n/index.ts";

/** How long an emailed link stays redeemable. */
export const MAGIC_TTL_MS = 15 * 60_000;

/** Rolling-hour ceiling per address, enforced silently so it leaks nothing. */
export const MAX_LINKS_PER_EMAIL_PER_HOUR = 5;

/** 32 bytes of CSPRNG entropy, base64url. Only its hash is ever stored. */
export function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
}

/** SHA-256 of the raw token, lowercase hex. */
export async function hashToken(raw: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Returns `value` only if it is a same-origin path inside `locale`; else `/${locale}`. */
export function safeRedirect(value: string | null | undefined, locale: Locale): string {
  const home = `/${locale}`;
  if (typeof value !== "string" || value === "") return home;
  if (value[0] !== "/") return home; // a scheme, or a bare word
  if (value[1] === "/" || value[1] === "\\") return home; // //evil.com, /\evil.com
  // The locale must match as a segment: /vivid is not inside /vi.
  if (value !== home && !value.startsWith(`${home}/`)) return home;
  try {
    if (new URL(value, "http://x").origin !== "http://x") return home;
  } catch {
    return home;
  }
  return value;
}

/** The configured canonical origin, or null when the deployment set none. */
export function linkOrigin(): string | null {
  const site = process.env.NEXT_PUBLIC_SITE_URL;
  return site ? site.replace(/\/+$/, "") : null;
}

/**
 * The absolute link that goes in the email.
 *
 * The origin comes from configuration ONLY. Building it from the Host header
 * would let an attacker mail a victim a link to the attacker's origin carrying
 * a token valid on ours — and a guessed default does the same to any fork or
 * preview that does not own the guess, so an unconfigured origin refuses.
 */
export function magicLinkUrl(token: string, locale: Locale): string {
  const origin = linkOrigin();
  if (!origin) throw new Error("NEXT_PUBLIC_SITE_URL must be set before a magic link can be mailed");
  return `${origin}/${locale}/${PATHS.login[locale]}/verify?token=${encodeURIComponent(token)}`;
}
