"use client";

import { useEffect } from "react";
import {
  flushWatchlistWrites,
  readWatchlist,
  readWatchlistOwner,
  setWatchlist,
  setWatchlistOwner,
  uploadWatchlist,
} from "./WatchButton";
import { localWriteGeneration, planSync, type SyncAction } from "@/lib/watchlist-sync";

/**
 * Keeps localStorage — still the live read model for the board and the rail —
 * in step with the signed-in reader's stored list. Renders nothing.
 *
 * The owner marker records which account this browser's copy belongs to, which
 * is what separates "first sign-in here, migrate what is local" from "already
 * synced, take the server's word for it" from "someone else's list, drop it".
 */
export function WatchlistSync({ email }: { email: string | null }) {
  useEffect(() => {
    const plan = planSync(readWatchlistOwner(), email);
    if (plan.clearLocal) {
      // Signed out, or a different account: the previous list must not linger
      // for whoever uses the machine next, nor be uploaded as theirs.
      setWatchlist([]);
      setWatchlistOwner(null);
    }
    if (email === null || plan.action === "none") return;

    let cancelled = false;
    const started = localWriteGeneration();

    async function sync(account: string, action: SyncAction) {
      // First sign-in here folds the anonymous list into the account; the
      // (user_id, symbol) primary key makes that idempotent. Afterwards the
      // server list is mirrored, never merged — merging would resurrect a
      // symbol deleted on another device from this browser's stale copy.
      const res = action === "upload" ? await uploadWatchlist(readWatchlist()) : await fetch("/api/watchlist");
      if (cancelled || !res?.ok) return;

      const body: unknown = await res.json();
      const symbols = (body as { data?: { symbols?: unknown } })?.data?.symbols;
      if (cancelled || !Array.isArray(symbols)) return;
      // A star toggled since this went out is newer than the answer. Leaving
      // the browser unclaimed makes the next mount fold that newer list in.
      if (localWriteGeneration() !== started) return;

      setWatchlist(symbols.filter((s): s is string => typeof s === "string"));
      setWatchlistOwner(account);
    }

    // A sync that cannot reach the server leaves the local list as it stands.
    void sync(email, plan.action).catch(() => {});

    const flush = () => flushWatchlistWrites();
    window.addEventListener("pagehide", flush);

    return () => {
      cancelled = true;
      window.removeEventListener("pagehide", flush);
    };
  }, [email]);

  return null;
}
