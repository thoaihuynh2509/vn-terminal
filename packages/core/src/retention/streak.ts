/**
 * "Five days in a row."
 *
 * A quiet count of consecutive days the reader opened the chart. Not a game and
 * not a nag — no badges, no interruption, no notification for breaking one. It
 * exists because a habit you can SEE is one you notice you have, and noticing is
 * most of what keeps it.
 *
 * Days are counted in Ho Chi Minh time, because the market's day is the one the
 * reader is keeping the habit with: opening the chart at 23:30 in Hanoi and
 * again at 00:30 must not count twice, and it must not break the run either.
 */
export interface Streak {
  /** `YYYY-MM-DD` in exchange local time. */
  lastDay: string;
  count: number;
}

export const STREAK_KEY = "streak:chart";

const ICT_OFFSET_MS = 7 * 3600 * 1000;

export function ictDay(at: Date): string {
  const shifted = new Date(at.getTime() + ICT_OFFSET_MS);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const d = String(shifted.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function dayBefore(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return ictDay(new Date(Date.UTC(y, m - 1, d) - 86_400_000 + ICT_OFFSET_MS));
}

/**
 * Fold today's visit into the streak.
 *
 * A second visit on the same day is not a second day — returning the identical
 * object also means the caller can skip a write.
 */
export function bumpStreak(prev: Streak | null, at: Date = new Date()): Streak {
  const today = ictDay(at);
  if (!prev || !/^\d{4}-\d{2}-\d{2}$/.test(prev.lastDay) || !Number.isFinite(prev.count) || prev.count < 1) {
    return { lastDay: today, count: 1 };
  }
  if (prev.lastDay === today) return prev;
  if (prev.lastDay === dayBefore(today)) return { lastDay: today, count: prev.count + 1 };
  // A gap of any length is a new run. Weekends included: the market is shut, so
  // a streak that only counts trading days would be a different, longer promise
  // than "days in a row", and the honest one is the one that matches the words.
  return { lastDay: today, count: 1 };
}

export function parseStreak(raw: string | null): Streak | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<Streak>;
    if (typeof v?.lastDay !== "string" || typeof v?.count !== "number") return null;
    return { lastDay: v.lastDay, count: v.count };
  } catch {
    return null;
  }
}
