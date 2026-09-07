/**
 * Undo and redo for anything kept as a whole value.
 *
 * Drawings are the reason this exists. A misplaced trendline currently has to be
 * hunted down and deleted, and an accidental delete cannot be taken back at all
 * — which makes readers cautious with the exact feature the retention thesis
 * depends on them using freely. Undo is what makes a canvas safe to experiment
 * on.
 *
 * Snapshots, not diffs. A drawing set is a handful of small objects, so storing
 * whole states costs almost nothing and removes the entire class of bug where an
 * inverse operation is subtly wrong. The depth cap is what keeps that honest.
 *
 * Pure and generic: no React, no storage, no drawing types.
 */

/** How many steps back a reader can go. Beyond this the oldest state is dropped. */
export const HISTORY_DEPTH = 50;

export interface History<T> {
  /** Oldest → newest. Never empty: index 0 is the state the stack was seeded with. */
  past: T[];
  /** Index into `past` of the state currently in force. */
  at: number;
}

export function initHistory<T>(present: T): History<T> {
  return { past: [present], at: 0 };
}

export function current<T>(h: History<T>): T {
  return h.past[h.at];
}

export function canUndo<T>(h: History<T>): boolean {
  return h.at > 0;
}

export function canRedo<T>(h: History<T>): boolean {
  return h.at < h.past.length - 1;
}

/**
 * Record a new state.
 *
 * Anything that had been undone is discarded — the reader chose a different
 * branch, and keeping the abandoned one would make redo mean something nobody
 * asked for. Equality is by the caller's `same` predicate so a drag that ends
 * where it started does not consume a step.
 */
export function push<T>(h: History<T>, next: T, same?: (a: T, b: T) => boolean): History<T> {
  if (same && same(current(h), next)) return h;
  const kept = h.past.slice(0, h.at + 1);
  kept.push(next);
  // Trim from the FRONT: the oldest state is the one a reader is least likely
  // to want back, and an unbounded stack is a memory leak on a long session.
  const over = kept.length - HISTORY_DEPTH;
  const past = over > 0 ? kept.slice(over) : kept;
  return { past, at: past.length - 1 };
}

export function undo<T>(h: History<T>): History<T> {
  return canUndo(h) ? { past: h.past, at: h.at - 1 } : h;
}

export function redo<T>(h: History<T>): History<T> {
  return canRedo(h) ? { past: h.past, at: h.at + 1 } : h;
}

/**
 * Replace the present without recording a step.
 *
 * For changes that came from somewhere else — another tab writing the same
 * storage key, or a sync adopting the account's copy. Those are not the
 * reader's own actions, so they must not become undo steps: undoing one would
 * silently re-upload the state their other device had just replaced.
 */
export function reset<T>(present: T): History<T> {
  return initHistory(present);
}
