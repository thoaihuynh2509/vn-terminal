"use client";

import { createContext, useContext, useLayoutEffect, useRef, type ReactNode } from "react";

/** The plot layers a pan moves between renders; see `ChartPro`'s drag. */
export interface PanLayers {
  add: (el: HTMLElement) => () => void;
}

export const PanLayersContext = createContext<PanLayers | null>(null);

/**
 * A registry of plot layers and the shift they all share.
 *
 * A drag moves the drawn plot by a transform on every pointer move, without a
 * render, and lets React catch up with the new window as fast as it can. A
 * layer that mounts mid-drag starts at the current shift.
 */
export function createPanLayers() {
  const els = new Set<HTMLElement>();
  let shift = "";
  return {
    add(el: HTMLElement) {
      els.add(el);
      el.style.transform = shift;
      return () => { els.delete(el); };
    },
    set(px: number) {
      const next = px ? `translate3d(${px}px,0,0)` : "";
      if (next === shift) return;
      shift = next;
      for (const el of els) el.style.transform = next;
    },
  };
}

/** A pane's plot area: clipped to the plot, and moved as one piece during a pan. */
export function PlotLayer({ left, width, height, children }: {
  left: number; width: number; height: number; children: ReactNode;
}) {
  const layers = useContext(PanLayersContext);
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    return el && layers ? layers.add(el) : undefined;
  }, [layers]);
  return (
    <div data-plot-clip="" className="pointer-events-none absolute top-0 overflow-hidden" style={{ left, width, height }}>
      <div ref={ref} data-pan-layer="" className="absolute inset-0" style={{ willChange: "transform" }}>
        {children}
      </div>
    </div>
  );
}
