"use client";

import { useLayoutEffect, useRef, useState, useEffect } from "react";

/**
 * The dense layer of a pane, on canvas, under the pane's SVG.
 *
 * Candles, volume, indicator lines and histograms scale with the number of
 * bars; as SVG path data every pan frame rebuilt and re-parsed all of it, and
 * no memo can help a window that moves every frame. Canvas takes the same
 * geometry as direct drawing calls. Everything sparse and interactive —
 * axes, crosshair, drawings, alerts — stays in the SVG above it.
 *
 * Sized to the device's pixel ratio, or it is soft on every retina screen: the
 * one way this would look worse than the SVG it replaces. The ratio is watched
 * as well as the size, because dragging a window to another display changes it
 * without resizing anything.
 */
export function PaneCanvas({
  width, height, draw, columns, layer, windowKey, compareDashes,
}: {
  /** CSS pixels — the pane SVG's own viewBox width, which is its rendered width. */
  width: number;
  height: number;
  draw: (ctx: CanvasRenderingContext2D) => void;
  /** Columns drawn, published for the interaction suite: canvas has no nodes to count. */
  columns?: number;
  /** What the price series is drawn as ("candles", "line", "area"), for the same reason. */
  layer?: string;
  /** Which bars are in view, so a harness can tell a pan moved the window. */
  windowKey?: string;
  /** The dash pattern of each compare line drawn — telling them apart is the point. */
  compareDashes?: string[];
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [dpr, setDpr] = useState(1);

  useEffect(() => {
    const update = () => setDpr(Math.min(3, window.devicePixelRatio || 1));
    update();
    const mq = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [dpr]);

  useLayoutEffect(() => {
    const c = ref.current;
    if (!c) return;
    const w = Math.max(1, Math.round(width * dpr));
    const h = Math.max(1, Math.round(height * dpr));
    if (c.width !== w) c.width = w;
    if (c.height !== h) c.height = h;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    draw(ctx);
  }, [width, height, dpr, draw]);

  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      data-pane-layer=""
      data-columns={columns}
      data-layer={layer}
      data-window={windowKey}
      data-compare-dashes={compareDashes?.length ? compareDashes.join("|") : undefined}
      className="pointer-events-none absolute left-0 top-0 block"
      style={{ width: "100%", height }}
    />
  );
}
