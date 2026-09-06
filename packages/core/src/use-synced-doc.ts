"use client";

import { useCallback, useEffect, useRef } from "react";
import { useStored, writeStored } from "./browser-store.ts";
import { SYNC_DEBOUNCE_MS, planDoc } from "./docs-sync.ts";

/**
 * Mirrors one saved artifact between this browser and the account.
 *
 * The local value keeps its existing storage key and format — a reader's saved
 * drawings must survive this feature shipping — so the sync bookkeeping (which
 * server version this copy came from, and whether it has unsent edits) lives in
 * a sibling key instead of being folded into the payload.
 *
 * Local-first, exactly like the watchlist: the browser copy is what renders, the
 * network is a background reconciliation, and every failure path leaves the
 * reader's own work untouched. When `canSync` is false — the free tier — this is
 * inert and the artifact simply stays on this device, which is the deal the
 * pricing page describes.
 */
interface Meta {
  version: number;
  dirty: boolean;
}

const metaKey = (kind: string, key: string) => `docmeta:${kind}:${key}`;

function parseMeta(raw: string | null): Meta {
  if (!raw) return { version: 0, dirty: false };
  try {
    const v = JSON.parse(raw) as Partial<Meta>;
    return {
      version: typeof v.version === "number" && v.version >= 0 ? v.version : 0,
      dirty: v.dirty === true,
    };
  } catch {
    return { version: 0, dirty: false };
  }
}

export interface SyncedDoc {
  /** Call after every local edit so the change is queued for upload. */
  markDirty: () => void;
  /** Force a reconciliation now (e.g. the reader just signed in). */
  sync: () => void;
}

export function useSyncedDoc<T>({
  kind,
  docKey,
  local,
  applyRemote,
  merge,
  canSync,
}: {
  kind: string;
  docKey: string;
  /** The current local value, already parsed. `null` when nothing is stored. */
  local: T | null;
  /** Adopt a server copy into local storage. */
  applyRemote: (data: T) => void;
  /** Combine both sides when each has changed since the last sync. */
  merge: (localData: T, remoteData: T) => T;
  canSync: boolean;
}): SyncedDoc {
  const rawMeta = useStored(metaKey(kind, docKey));
  const meta = parseMeta(rawMeta);

  // Read through refs inside the async reconciliation: it is started from an
  // effect and resolves later, by which time the render that scheduled it is
  // long gone and its captured values may describe a different symbol.
  const state = useRef({ local, meta, canSync, applyRemote, merge, kind, docKey });
  useEffect(() => {
    state.current = { local, meta, canSync, applyRemote, merge, kind, docKey };
  });

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(false);

  const writeMeta = useCallback((next: Meta) => {
    writeStored(metaKey(state.current.kind, state.current.docKey), JSON.stringify(next));
  }, []);

  const reconcile = useCallback(async () => {
    const s = state.current;
    if (!s.canSync || inFlight.current) return;
    inFlight.current = true;
    try {
      const url = `/api/docs?kind=${encodeURIComponent(s.kind)}&key=${encodeURIComponent(s.docKey)}`;
      const res = await fetch(url, { headers: { accept: "application/json" } });
      // 401/402/501 are all "syncing is not available to you right now" — the
      // reader keeps working locally and is never shown a network error for it.
      if (!res.ok) return;
      const body = (await res.json()) as { data?: { data: T; version: number } | null };
      const remote = body.data ? { data: body.data.data, version: body.data.version } : null;

      const localDoc = s.local === null ? null : { data: s.local, version: s.meta.version, dirty: s.meta.dirty };
      const action = planDoc(localDoc, remote);
      if (action === "none") return;

      if (action === "adopt" && remote) {
        s.applyRemote(remote.data);
        writeMeta({ version: remote.version, dirty: false });
        return;
      }

      const payload =
        action === "merge" && remote && s.local !== null
          ? s.merge(s.local, remote.data)
          : s.local;
      if (payload === null) return;
      if (action === "merge") s.applyRemote(payload);

      const put = await fetch("/api/docs", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: s.kind, key: s.docKey, data: payload,
          // Naming the version we believe we hold is what lets the server refuse
          // a stale write instead of silently overwriting another device.
          ...(remote ? { version: remote.version } : {}),
        }),
        keepalive: true,
      });
      if (!put.ok && put.status !== 409) return;
      const saved = (await put.json()) as { data?: { saved: boolean; doc: { data: T; version: number } } };
      if (!saved.data) return;
      if (saved.data.saved) {
        writeMeta({ version: saved.data.doc.version, dirty: false });
      } else {
        // We lost a race. Take what won and keep our edits queued for the next
        // pass rather than dropping them.
        s.applyRemote(saved.data.doc.data);
        writeMeta({ version: saved.data.doc.version, dirty: true });
      }
    } catch {
      /* offline or blocked: local storage is still correct, try again later */
    } finally {
      inFlight.current = false;
    }
  }, [writeMeta]);

  const markDirty = useCallback(() => {
    if (!state.current.canSync) return;
    writeMeta({ version: state.current.meta.version, dirty: true });
    if (timer.current) clearTimeout(timer.current);
    // A reader dragging a level emits a change per frame; one request per drag
    // is the point of the delay.
    timer.current = setTimeout(() => void reconcile(), SYNC_DEBOUNCE_MS);
  }, [reconcile, writeMeta]);

  // Reconcile on mount and whenever the artifact being watched changes — moving
  // to another symbol is a different document.
  useEffect(() => {
    if (!canSync) return;
    void reconcile();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [canSync, kind, docKey, reconcile]);

  return { markDirty, sync: () => void reconcile() };
}
