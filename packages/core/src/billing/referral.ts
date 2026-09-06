/**
 * Referral codes.
 *
 * A code is a public handle for an account that is safe to put in a shared URL —
 * it is NOT the email and reveals nothing. Generated from an unambiguous
 * alphabet (no O/0, I/1) so it survives being read aloud or retyped.
 */
import { randomInt } from "node:crypto";

export const REFERRAL_REWARD_DAYS = 30;

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LEN = 8;

export function newReferralCode(): string {
  let out = "";
  for (let i = 0; i < CODE_LEN; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}

/** Upper-case and validate a code from a URL/cookie; null if it is not one. */
export function normalizeCode(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const up = v.trim().toUpperCase();
  return /^[A-Z0-9]{6,16}$/.test(up) ? up : null;
}
