"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";

/**
 * Shared crosshair for a multi-chart grid.
 *
 * The hovered MOMENT is shared, not the hovered bar index — two symbols do not
 * have the same bars, so an index would line up unrelated sessions. Each cell
 * resolves the moment against its own series (`linkedIndex`) and shows nothing
 * if it has no bar there.
 *
 * The terminal wraps even a single chart in the provider. What keeps that cheap
 * is that each chart reads this context in one leaf (`CrosshairSync`, in
 * `ChartPro`), so a change re-renders that leaf rather than the chart. Outside
 * any provider the default context is inert and `useChartSync` returns nulls.
 */
interface ChartSyncValue {
  /** Unix seconds under the pointer, in whichever cell is driving. */
  hoverT: number | null;
  /** Which cell published it, so the source can keep its own exact index. */
  sourceId: string | null;
  publish: (id: string, t: number | null) => void;
}

const INERT: ChartSyncValue = { hoverT: null, sourceId: null, publish: () => {} };

const Ctx = createContext<ChartSyncValue>(INERT);

export function useChartSync(): ChartSyncValue {
  return useContext(Ctx);
}

export function ChartSyncProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<{ hoverT: number | null; sourceId: string | null }>({
    hoverT: null, sourceId: null,
  });

  /**
   * Stable for the life of the provider.
   *
   * Identity matters more than it looks: cells publish from an effect, so a
   * `publish` that changed whenever the shared state did would re-run EVERY
   * cell's effect on every pointer move. The companions, having no hover of
   * their own, would then publish null and wipe the crosshair the source had
   * just set — the grid would look linked for one frame and then go blank.
   */
  const publish = useCallback((id: string, t: number | null) => {
    setState((prev) => {
      const nextSource = t === null ? null : id;
      // Returning the same object is what keeps a pointer crossing one candle —
      // dozens of events — from re-rendering four charts.
      if (prev.hoverT === t && prev.sourceId === nextSource) return prev;
      return { hoverT: t, sourceId: nextSource };
    });
  }, []);

  const value = useMemo<ChartSyncValue>(
    () => ({ hoverT: state.hoverT, sourceId: state.sourceId, publish }),
    [state.hoverT, state.sourceId, publish],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
