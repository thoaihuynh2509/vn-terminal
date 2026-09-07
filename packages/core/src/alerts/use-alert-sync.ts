"use client";

import { useCallback, useEffect, useRef } from "react";
import { SYNC_DEBOUNCE_MS } from "../docs-sync.ts";
import { sanitizeAlerts, serializeAlerts, STORAGE_KEY, type PriceAlert } from "./alerts.ts";

/**
 * Mirrors the reader's alerts between this browser and their account.
 *
 * Simpler than the saved-artifact sync on purpose: alerts are one flat list the
 * browser fully owns, `db.alerts.replace` is a single transaction, and the
 * server list exists so the nightly job can evaluate alerts while the tab is
 * closed — not so two devices can edit the same alert concurrently. So this is
 * replace-all, last-writer-wins, rather than a per-item merge.
 *
 * On the first sync of a session the ACCOUNT wins: alerts already stored are
 * what the cron has been watching, and adopting them is how a second device
 * inherits the list instead of quietly deleting it by uploading an empty one.
 * After that the browser is authoritative for everything it changes.
 *
 * Inert when `canSync` is false — free alerts live in this browser and fire in
 * the open tab, exactly as the panel's scope note says.
 */
export function useAlertSync({
  local,
  applyRemote,
  canSync,
}: {
  local: PriceAlert[];
  applyRemote: (alerts: PriceAlert[]) => void;
  canSync: boolean;
}): { markDirty: () => void } {
  const state = useRef({ local, applyRemote, canSync });
  useEffect(() => {
    state.current = { local, applyRemote, canSync };
  });

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const adopted = useRef(false);
  const inFlight = useRef(false);

  const push = useCallback(async () => {
    const s = state.current;
    if (!s.canSync || inFlight.current) return;
    inFlight.current = true;
    try {
      await fetch("/api/alerts", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ alerts: s.local }),
        keepalive: true, // a tab closing mid-debounce must not lose the change
      });
    } catch {
      /* offline: the browser copy is still correct and still fires locally */
    } finally {
      inFlight.current = false;
    }
  }, []);

  const markDirty = useCallback(() => {
    if (!state.current.canSync) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void push(), SYNC_DEBOUNCE_MS);
  }, [push]);

  useEffect(() => {
    if (!canSync || adopted.current) return;
    adopted.current = true;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/alerts", { headers: { accept: "application/json" } });
        if (!res.ok || cancelled) return;
        const body = (await res.json()) as { data?: unknown };
        const remote = sanitizeAlerts(body.data);
        const s = state.current;
        // Union by id, so a device that armed an alert offline keeps it while
        // still inheriting whatever the account already had.
        const byId = new Map(remote.map((a) => [a.id, a]));
        for (const a of s.local) byId.set(a.id, a);
        const merged = [...byId.values()];
        if (merged.length !== remote.length || s.local.length !== remote.length) {
          s.applyRemote(merged);
          void push();
        }
      } catch {
        /* the account copy is unreachable; local alerts keep working */
      }
    })();
    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [canSync, push]);

  return { markDirty };
}

/** Convenience for callers that hold the list as a string in storage. */
export function alertsToStorage(alerts: PriceAlert[]): string | null {
  return alerts.length ? serializeAlerts(alerts) : null;
}

export { STORAGE_KEY };
