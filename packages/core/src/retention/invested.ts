/**
 * Who has INVESTED in the chart, and how much.
 *
 * The roadmap's north star is that a reader with a saved artifact returns more
 * often than one without. That thesis is either true or it is not, and it can
 * only be checked against a count of who actually has one — which nothing has
 * ever measured, because the admin page reports the orders ledger and nothing
 * else.
 *
 * Pure so the definition of "invested" lives in one place and is testable:
 * counting it differently on the dashboard than in the analytics would make the
 * two disagree about the number the whole roadmap is bet on.
 */
import type { DocRecord } from "../db/types.ts";

/** A saved artifact of any kind counts. */
export const INVESTED_KINDS = ["drawings", "layout", "template"] as const;

export interface InvestedStats {
  /** Readers with at least one saved artifact. */
  invested: number;
  /** Saved artifacts by kind. */
  byKind: Record<string, number>;
  total: number;
}

/**
 * Count artifacts and the readers holding them.
 *
 * `settings` is deliberately NOT an artifact: it is written the first time a
 * reader toggles anything, so counting it would report almost every visitor as
 * invested and make the metric say nothing.
 */
export function investedStats(docs: { userId: string; kind: string }[]): InvestedStats {
  const kinds = new Set<string>(INVESTED_KINDS);
  const users = new Set<string>();
  const byKind: Record<string, number> = {};
  let total = 0;
  for (const d of docs) {
    if (!kinds.has(d.kind)) continue;
    users.add(d.userId);
    byKind[d.kind] = (byKind[d.kind] ?? 0) + 1;
    total++;
  }
  return { invested: users.size, byKind, total };
}

/** Alerts that fired in the last `days`, from their stored fire time. */
export function firedSince(
  alerts: { firedAt?: number | null }[],
  nowMs: number,
  days = 7,
): number {
  const cutoff = nowMs - days * 86_400_000;
  return alerts.filter((a) => typeof a.firedAt === "number" && a.firedAt >= cutoff).length;
}

/** Unused, but the shape the admin page reads. */
export type { DocRecord };
