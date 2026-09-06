/**
 * The decisions a saved-artifact sync makes, kept out of the components so they
 * can be tested. Nothing here touches storage or the network.
 *
 * Ownership is not re-derived: `planSync` from the watchlist sync already
 * answers "whose copy is this browser holding", and having two answers to that
 * question is how one account's work ends up uploaded into another's.
 */
export { planSync, type SyncAction, type SyncPlan } from "./watchlist-sync.ts";

/** What the reader's browser holds. `dirty` means it has edits not yet sent. */
export interface LocalDoc<T> {
  data: T;
  /** The server version this copy was derived from; 0 before it was ever sent. */
  version: number;
  dirty: boolean;
}

/** What the server holds. */
export interface RemoteDoc<T> {
  data: T;
  version: number;
}

export type DocAction =
  | "upload" // local is authoritative — send it
  | "adopt" // remote moved on and we have nothing unsent — take it
  | "merge" // both sides changed — combine, then send
  | "none";

/**
 * Decide what one document should do on a sync.
 *
 * The ordering matters: a dirty local copy that is also behind the server is the
 * only genuine conflict, and it must be merged rather than resolved by picking a
 * winner — picking would silently discard whichever device the reader was not
 * looking at.
 */
export function planDoc<T>(local: LocalDoc<T> | null, remote: RemoteDoc<T> | null): DocAction {
  if (!remote) return local && local.dirty ? "upload" : "none";
  if (!local) return "adopt";
  if (local.dirty && remote.version > local.version) return "merge";
  if (local.dirty) return "upload";
  if (remote.version > local.version) return "adopt";
  return "none";
}

/**
 * Union two lists of identified items, preferring the local copy of anything
 * present on both sides — that is the edit the reader made most recently on the
 * device in front of them.
 *
 * Honest limitation: this is a union, so an item deleted on one device while
 * offline reappears if the other device still has it. Fixing that needs
 * tombstones, and a resurrected trend line is a far smaller harm than silently
 * dropping work; a deletion that has been synced stays deleted, because both
 * sides then agree it is gone.
 */
export function mergeById<T extends { id: string }>(local: T[], remote: T[]): T[] {
  const out = [...local];
  const seen = new Set(local.map((x) => x.id));
  for (const item of remote) if (!seen.has(item.id)) out.push(item);
  return out;
}

/**
 * Collapse a burst of edits into one request. A reader dragging a level emits a
 * change per frame; without this each one is a PUT.
 */
export const SYNC_DEBOUNCE_MS = 800;
