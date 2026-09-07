/**
 * Which symbols to overlay for relative strength.
 *
 * The chart could only ever overlay VNINDEX, while the pricing page advertised
 * comparing symbols — one of the overpromises Phase 0 had to reword rather than
 * fix. This is the fix.
 *
 * "Is my stock beating its sector peer" is the question a holder actually asks,
 * and answering it against the index alone is answering a different one.
 */
import type { Tier } from "../auth/entitlement.ts";

/** Overlay series a tier may show at once. */
export const COMPARE_LIMIT: Record<Tier, number> = { anon: 0, free: 0, plus: 1, pro: 3 };

/** The index every reader means by "the market". */
export const DEFAULT_COMPARE = "VNINDEX";

const SYMBOL_RE = /^[A-Z0-9]{1,10}$/;

/**
 * Parse `?cmp=` into the symbols to overlay.
 *
 * `cmp=1` still means VNINDEX: that is what every link shared before this
 * existed says, and breaking those would be a self-inflicted 404 on the one
 * feature we are widening.
 *
 * The subject symbol is dropped if named — overlaying a stock on itself draws a
 * flat line at 100% and looks like a bug.
 */
export function parseCompare(raw: string | null | undefined, tier: Tier, self: string): string[] {
  const limit = COMPARE_LIMIT[tier];
  if (!raw || limit <= 0) return [];
  if (raw === "1") return [DEFAULT_COMPARE];

  const out: string[] = [];
  const seen = new Set<string>([self.toUpperCase()]);
  for (const part of raw.split(",")) {
    const sym = part.trim().toUpperCase();
    if (!SYMBOL_RE.test(sym) || seen.has(sym)) continue;
    seen.add(sym);
    out.push(sym);
    if (out.length >= limit) break;
  }
  return out;
}

/** The `?cmp=` value for a set of overlays, or null to drop the parameter. */
export function encodeCompare(symbols: string[]): string | null {
  return symbols.length ? symbols.join(",") : null;
}

/**
 * Dash patterns, so several overlays are distinguishable without relying on
 * colour — the same rule the candles follow. Cycled, so a fourth series would
 * repeat rather than fall back to a solid line that reads as price.
 */
export const COMPARE_DASH = ["5 3", "2 3", "8 3 2 3"] as const;

export function dashFor(i: number): string {
  return COMPARE_DASH[i % COMPARE_DASH.length];
}
