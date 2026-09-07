"use client";

import { useStored, writeStored } from "@/lib/browser-store";
import { track } from "@/lib/analytics/posthog";
import {
  hasWrites,
  markLocalWrite,
  noWrites,
  queueToggle,
  type PendingWrites,
} from "@/lib/watchlist-sync";

/** Exported so other surfaces read the same list rather than a second copy. */
export const WATCH_KEY = "watchlist";
const KEY = WATCH_KEY;
/** Set once a signed-in reader has claimed this browser's list; see WatchlistSync. */
const OWNER_KEY = "watchlist:owner";

// browser-store keeps its guarded read private, and reading localStorage throws
// outright in private mode, so the imperative paths guard their own access.
function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function parseWatchlist(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? (v as string[]) : [];
  } catch {
    return [];
  }
}

export function useWatchlistRaw() {
  return useStored(KEY);
}

export function setWatchlist(list: string[]) {
  writeStored(KEY, list.length ? JSON.stringify(list) : null);
}

export function readWatchlist(): string[] {
  return parseWatchlist(readStored(KEY));
}

export function readWatchlistOwner(): string | null {
  return readStored(OWNER_KEY);
}

export function setWatchlistOwner(email: string | null) {
  writeStored(OWNER_KEY, email);
}

/** Idle window a burst of stars is collected over before one PATCH goes out. */
const FLUSH_MS = 400;

let pending: PendingWrites = noWrites();
let timer: ReturnType<typeof setTimeout> | null = null;
// One request at a time, in the order they were queued: an add overtaking the
// remove of the same symbol resurrects it on the server.
let chain: Promise<Response | null> = Promise.resolve(null);

function send(writes: PendingWrites): Promise<Response | null> {
  const run = () =>
    fetch("/api/watchlist", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      // A star immediately before a navigation still has to ship.
      keepalive: true,
      body: JSON.stringify(writes),
    }).catch(() => null);
  chain = chain.then(run, run);
  return chain;
}

/** Sends what has accumulated, if anything. Safe to call at any time. */
export function flushWatchlistWrites(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  if (!hasWrites(pending)) return;
  const writes = pending;
  pending = noWrites();
  void send(writes);
}

/** Folds a whole list into the account, ahead of any star queued after it. */
export function uploadWatchlist(symbols: string[]): Promise<Response | null> {
  return send({ add: symbols, remove: [] });
}

/**
 * Toggle the star. localStorage stays the live read model for signed-out and
 * signed-in readers alike; the account copy is mirrored best-effort, so a failed
 * request leaves the local toggle intact and the next sync reconciles it.
 */
export function toggleWatch(symbol: string) {
  const list = readWatchlist();
  const on = list.includes(symbol);
  setWatchlist(on ? list.filter((s) => s !== symbol) : [...list, symbol]);
  markLocalWrite();
  if (!on) track("watchlist_added", { symbol }); // adding is the activation signal

  // Signed out, or not yet claimed: localStorage is the whole story.
  if (!readWatchlistOwner()) return;
  pending = queueToggle(pending, symbol, !on);
  if (timer !== null) clearTimeout(timer);
  timer = setTimeout(flushWatchlistWrites, FLUSH_MS);
}

export function WatchButton({
  symbol,
  addLabel,
  removeLabel,
}: {
  symbol: string;
  addLabel: string;
  removeLabel: string;
}) {
  const list = parseWatchlist(useStored(KEY));
  const on = list.includes(symbol);

  return (
    <button
      type="button"
      onClick={() => toggleWatch(symbol)}
      aria-pressed={on}
      aria-label={on ? removeLabel : addLabel}
      title={on ? removeLabel : addLabel}
      className={`grid h-6 w-6 place-items-center rounded text-[13px] leading-none hover:bg-surface-2 ${
        on ? "text-accent" : "text-muted"
      }`}
    >
      <span aria-hidden="true">{on ? "★" : "☆"}</span>
    </button>
  );
}
