"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Gate } from "./GateHint";
import { DRAWING_LIMIT, can } from "@/lib/auth/entitlement";
import { parseDrawings, serializeDrawings, storageKey, type Drawing } from "@/lib/chart/drawings";
import { canRedo as histCanRedo, canUndo as histCanUndo, current as histCurrent, initHistory, push as histPush, redo as histRedo, reset as histReset, undo as histUndo, type History } from "@/lib/chart/history";
import { useStored, writeStored } from "@/lib/browser-store";
import { useSyncedDoc } from "@/lib/use-synced-doc";
import { mergeById } from "@/lib/docs-sync";
import { track } from "@/lib/analytics/posthog";
import type { Tier } from "@/lib/types";

export type RaiseGate = (g: { gate: Gate; limit?: number; asked?: boolean }) => void;

/** A symbol's drawings: stored, synced on a tier that syncs, undoable, and capped per tier. */
export function useDrawingStore({ symbol, tier, raiseGate }: { symbol: string; tier: Tier; raiseGate: RaiseGate }) {
  const stored = useStored(storageKey(symbol));
  const drawings = useMemo(() => parseDrawings(stored), [stored]);
  const writeDrawings = useCallback(
    (next: Drawing[]) => writeStored(storageKey(symbol), next.length ? serializeDrawings(next) : null),
    [symbol],
  );

  // Drawings follow the account only on a tier that bought portability; on free
  // they stay in this browser, which is exactly what the pricing page promises.
  const canSync = can(tier, "sync:docs");
  const drawLimit = DRAWING_LIMIT[tier];
  const mergeDrawings = useCallback(
    (mine: Drawing[], theirs: Drawing[]) => mergeById(mine, theirs).slice(0, drawLimit),
    [drawLimit],
  );
  const { markDirty } = useSyncedDoc<Drawing[]>({
    kind: "drawings",
    docKey: symbol,
    local: drawings,
    applyRemote: writeDrawings,
    merge: mergeDrawings,
    canSync,
  });

  const [selectedId, setSelectedId] = useState<string | null>(null);

  /**
   * Undo history for this symbol's drawings.
   *
   * Held in a ref rather than state because it is only ever read inside
   * handlers: rendering does not depend on the stack, only on what is stored,
   * so keeping it in state would re-render the chart on every recorded step for
   * nothing.
   */
  const hist = useRef<History<Drawing[]>>(initHistory(drawings));
  /**
   * Whether the buttons are live.
   *
   * Mirrored into state rather than read off the ref during render: a ref read
   * at render time is not a legal read point, and the buttons have to change
   * the moment the stack does.
   */
  const [histFlags, setHistFlags] = useState({ undo: false, redo: false });
  const applyHist = useCallback((next: History<Drawing[]>) => {
    hist.current = next;
    const flags = { undo: histCanUndo(next), redo: histCanRedo(next) };
    setHistFlags((f) => (f.undo === flags.undo && f.redo === flags.redo ? f : flags));
  }, []);
  /** The last value WE wrote, so a change from elsewhere can be told apart. */
  const lastWritten = useRef<string | null>(null);

  // A write from another tab, or a sync adopting the account's copy, is not the
  // reader's own action — it reseeds the stack instead of becoming an undo step,
  // because undoing it would re-upload what the other device just replaced.
  useEffect(() => {
    const raw = serializeDrawings(drawings);
    if (raw === lastWritten.current) return;
    lastWritten.current = raw;
    applyHist(histReset(drawings));
    setSelectedId(null);
  }, [drawings, applyHist]);

  // Every mutation goes through here so a local edit is both stored and queued.
  const saveDrawings = useCallback(
    (next: Drawing[]) => {
      lastWritten.current = serializeDrawings(next);
      writeDrawings(next);
      markDirty();
    },
    [writeDrawings, markDirty],
  );

  /** A reader-initiated change: stored, queued for sync, and undoable. */
  const commitDrawings = useCallback(
    (next: Drawing[]) => {
      applyHist(histPush(hist.current, next, (a, b) => serializeDrawings(a) === serializeDrawings(b)));
      saveDrawings(next);
    },
    [saveDrawings, applyHist],
  );

  const deleteSelected = useCallback(() => {
    if (!selectedId) return;
    const gone = drawings.find((d) => d.id === selectedId);
    commitDrawings(drawings.filter((d) => d.id !== selectedId));
    setSelectedId(null);
    if (gone) track("chart_drawing_deleted", { kind: gone.kind, symbol });
  }, [selectedId, drawings, commitDrawings, symbol]);

  const stepHistory = useCallback((dir: "undo" | "redo") => {
    const before = hist.current;
    const after = dir === "undo" ? histUndo(before) : histRedo(before);
    if (after === before) return;
    applyHist(after);
    const next = histCurrent(after);
    // Written directly rather than through commitDrawings: stepping through
    // history must not record a new step, or undo could never reach the start.
    saveDrawings(next);
    setSelectedId((id) => (next.some((d) => d.id === id) ? id : null));
    track("chart_drawing_history", { dir, symbol });
  }, [saveDrawings, symbol, applyHist]);

  // The free ceiling is enforced here because free drawings never reach the
  // server; the paid ceiling is re-checked there. Both read DRAWING_LIMIT, so
  // the two cannot drift.
  const addDrawing = useCallback(
    (d: Drawing) => {
      if (drawings.length >= drawLimit) {
        track("chart_limit_hit", { gate: "drawing", tier, limit: drawLimit, symbol });
        // Refusing silently reads as a bug; the fourth line simply not appearing
        // is indistinguishable from a broken tool.
        raiseGate({ gate: "drawing", limit: drawLimit });
        return false;
      }
      commitDrawings([...drawings, d]);
      track("chart_drawing_created", { kind: d.kind, count: drawings.length + 1, symbol });
      return true;
    },
    [drawings, drawLimit, commitDrawings, tier, symbol, raiseGate],
  );

  return { drawings, selectedId, setSelectedId, histFlags, commitDrawings, addDrawing, deleteSelected, stepHistory };
}
