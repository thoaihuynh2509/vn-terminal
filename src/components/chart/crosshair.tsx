"use client";

import { createContext, useContext, useSyncExternalStore } from "react";
import { clampHover } from "@/lib/chart/pan";

export interface CrosshairState {
  /** The bar under this cell's own pointer, as an index into the visible window. */
  hover: number | null;
  /**
   * The pointer's own height in the price pane, so the crosshair can answer
   * "what price is my cursor at" rather than only "what did this candle close at".
   */
  cursorY: number | null;
  /** The bar a sibling cell's crosshair resolves to here; see `ChartPro`'s `linked`. */
  linked: number | null;
}
const IDLE: CrosshairState = { hover: null, cursorY: null, linked: null };

/**
 * The crosshair, held outside React state.
 *
 * As chart state it re-rendered the chart, every pane and every layer on each
 * pointer move. Here a move re-renders only the components that draw it.
 */
export function createCrosshair() {
  let state = IDLE;
  const subs = new Set<() => void>();
  return {
    get: () => state,
    set(next: Partial<CrosshairState>) {
      const merged = { ...state, ...next };
      if (merged.hover === state.hover && merged.cursorY === state.cursorY && merged.linked === state.linked) return;
      state = merged;
      subs.forEach((f) => f());
    },
    subscribe(f: () => void) {
      subs.add(f);
      return () => { subs.delete(f); };
    },
  };
}
export type Crosshair = ReturnType<typeof createCrosshair>;

export const CrosshairContext = createContext<Crosshair | null>(null);

const detached = () => () => {};

/** One derived value, so a component re-renders only when that value changes. */
function usePick<T>(pick: (s: CrosshairState) => T): T {
  const store = useContext(CrosshairContext);
  return useSyncExternalStore(
    store ? store.subscribe : detached,
    () => pick(store ? store.get() : IDLE),
    () => pick(IDLE),
  );
}

/**
 * The bar the crosshair is on in a window of `length` bars: this cell's own
 * pointer, else a sibling cell's. Clamped, because the index was picked against
 * a window a zoom may since have re-sliced — see `clampHover`.
 */
export function useHoverIndex(length: number): number | null {
  return usePick((s) => clampHover(s.hover ?? s.linked, length));
}

/** This cell's own hovered bar, ignoring a sibling's. */
export function useOwnHover(): number | null {
  return usePick((s) => s.hover);
}

export function useCursorY(): number | null {
  return usePick((s) => s.cursorY);
}

/** A pane's vertical crosshair line. */
export function CrosshairLine({ x, height, length }: { x: (i: number) => number; height: number; length: number }) {
  const hover = useHoverIndex(length);
  return hover === null ? null : <line x1={x(hover)} x2={x(hover)} y1={0} y2={height} stroke="var(--axis)" strokeWidth={1} />;
}
