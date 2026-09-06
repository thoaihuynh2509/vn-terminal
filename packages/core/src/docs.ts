/**
 * Policy for saved chart artifacts — what may be stored, under what name, and
 * how much of it a tier may keep.
 *
 * Pure and dependency-free so the same rules can be asserted in tests and run on
 * the server. The route is deliberately thin: every judgement lives here, and
 * `validateDoc` is the single place a cap is decided, so the API and the pricing
 * page can never drift apart about what a tier actually gets.
 */
import { DRAWING_LIMIT, LAYOUT_LIMIT, type Tier } from "./auth/entitlement.ts";

export const DOC_KINDS = ["drawings", "layout", "template", "settings"] as const;
export type DocKind = (typeof DOC_KINDS)[number];

export function isDocKind(v: unknown): v is DocKind {
  return typeof v === "string" && (DOC_KINDS as readonly string[]).includes(v);
}

/** Mirrors the CHECK constraint on `user_docs.key` (migration 006). */
const KEY_RE = /^[A-Za-z0-9][A-Za-z0-9 _.-]{0,63}$/;

/**
 * A ceiling on one stored document. Not a guess: a drawing is a handful of
 * numbers, so 16 KB is thousands of them, while an unbounded blob is a way to
 * turn a text field into free file hosting.
 */
export const MAX_DOC_BYTES = 16 * 1024;

/**
 * Saved setups share one budget so the pricing page can state a single number.
 * A layout and a template are the same promise to the reader — "a setup you can
 * come back to" — and splitting the count would make the limit unexplainable.
 */
export const SETUP_KINDS: DocKind[] = ["layout", "template"];

export type DocError =
  | "unknown_kind"
  | "bad_key"
  | "too_large"
  | "bad_shape"
  | "drawing_limit"
  | "setup_limit";

export interface DocContext {
  tier: Tier;
  /** Saved setups this reader already has, EXCLUDING the key being written. */
  setupCount?: number;
}

export interface DocCheck {
  ok: boolean;
  error?: DocError;
  /** The ceiling that refused the write, for the upgrade prompt's copy. */
  limit?: number;
}

const fail = (error: DocError, limit?: number): DocCheck => ({ ok: false, error, limit });

/**
 * Decide whether one write is allowed.
 *
 * `setupCount` must exclude the key being written, so re-saving an existing
 * layout at the cap is an update rather than a refusal — otherwise the last slot
 * becomes read-only, which reads as a bug rather than a limit.
 */
export function validateDoc(
  kind: string,
  key: string,
  data: unknown,
  { tier, setupCount = 0 }: DocContext,
): DocCheck {
  if (!isDocKind(kind)) return fail("unknown_kind");
  if (typeof key !== "string" || !KEY_RE.test(key)) return fail("bad_key");

  let size: number;
  try {
    const json = JSON.stringify(data);
    if (json === undefined) return fail("bad_shape");
    size = Buffer.byteLength(json, "utf8");
  } catch {
    return fail("bad_shape"); // circular, BigInt, or otherwise not storable
  }
  if (size > MAX_DOC_BYTES) return fail("too_large", MAX_DOC_BYTES);

  if (kind === "drawings") {
    if (!Array.isArray(data)) return fail("bad_shape");
    const limit = DRAWING_LIMIT[tier];
    if (data.length > limit) return fail("drawing_limit", limit);
    return { ok: true };
  }

  if (kind === "settings") {
    if (data === null || typeof data !== "object" || Array.isArray(data)) return fail("bad_shape");
    return { ok: true }; // one small object per reader; no count to cap
  }

  // layout | template — the shared setup budget.
  if (data === null || typeof data !== "object") return fail("bad_shape");
  const limit = LAYOUT_LIMIT[tier];
  if (setupCount >= limit) return fail("setup_limit", limit);
  return { ok: true };
}

/** HTTP status for each refusal: a cap is a payment problem, a shape is a bug. */
export function statusFor(error: DocError): number {
  return error === "drawing_limit" || error === "setup_limit" ? 402 : 400;
}
