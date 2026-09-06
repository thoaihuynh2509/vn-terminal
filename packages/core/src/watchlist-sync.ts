/**
 * The decisions the watchlist sync makes, kept out of the client components so
 * they can be tested: which account a browser's copy belongs to, and how a
 * burst of stars collapses into one request. Nothing here touches storage or
 * the network.
 */

/** What a mount does with the browser's copy. */
export type SyncAction = "upload" | "mirror" | "none";

export interface SyncPlan {
  /** A list belonging to another account must be dropped, never uploaded. */
  clearLocal: boolean;
  action: SyncAction;
}

/**
 * `owner` is the account marker stored beside the list; `email` is who is
 * signed in now. Only an UNCLAIMED list is folded into an account: an owner
 * that names someone else is account A's list sitting in account B's browser,
 * and uploading it would hand B everything A was watching.
 */
export function planSync(owner: string | null, email: string | null): SyncPlan {
  if (email === null) return { clearLocal: owner !== null, action: "none" };
  if (owner === null) return { clearLocal: false, action: "upload" };
  if (owner === email) return { clearLocal: false, action: "mirror" };
  return { clearLocal: true, action: "mirror" };
}

/** Toggles waiting to be sent as one PATCH. */
export interface PendingWrites {
  add: string[];
  remove: string[];
}

export function noWrites(): PendingWrites {
  return { add: [], remove: [] };
}

export function hasWrites(writes: PendingWrites): boolean {
  return writes.add.length > 0 || writes.remove.length > 0;
}

/**
 * Fold one toggle into the batch. The last toggle of a symbol is the one that
 * ships — star-then-unstar leaves a single removal rather than two requests,
 * and the batch always describes the state the reader can see.
 */
export function queueToggle(pending: PendingWrites, symbol: string, starred: boolean): PendingWrites {
  const add = pending.add.filter((s) => s !== symbol);
  const remove = pending.remove.filter((s) => s !== symbol);
  (starred ? add : remove).push(symbol);
  return { add, remove };
}

/**
 * Bumped by every local star. A sync captures it before its request and drops
 * the answer if it moved, so a star toggled mid-flight is not un-filled by a
 * response that was sent before it happened.
 */
let generation = 0;

export function markLocalWrite(): void {
  generation += 1;
}

export function localWriteGeneration(): number {
  return generation;
}
