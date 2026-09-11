"use client";

import { useSyncExternalStore } from "react";

/** The tokens a canvas layer paints with. SVG reads these as `var(--…)`; canvas cannot. */
const TOKENS = ["up", "down", "surface", "accent", "muted", "ink-2", "grid"] as const;
export type ChartToken = (typeof TOKENS)[number];
export type ChartColors = Record<ChartToken, string>;

/**
 * The chart's colours, resolved to literals and kept current across theme changes.
 *
 * Canvas has no `var()`: a colour has to be read out of the computed style and
 * handed to it. Read once, it would freeze on whatever theme the page loaded
 * in — so this re-reads when `data-theme` flips (the toggle) and when the
 * system scheme changes (a reader on "system" whose OS switches at dusk).
 *
 * The snapshot keeps its identity until a colour actually changes, because
 * every canvas layer redraws when this object does.
 */
let cached: ChartColors | null = null;
/**
 * `useSyncExternalStore` calls the snapshot getter on EVERY render, and a
 * computed-style read forces a synchronous style recalculation whenever styles
 * are dirty — as they are mid-hover. Across a dozen panes on every crosshair
 * move, that would undo the whole point. So the read only happens after the
 * theme has signalled a change; every other render returns the cached object.
 */
let dirty = true;

function read(): ChartColors {
  if (!dirty && cached) return cached;
  dirty = false;
  const cs = getComputedStyle(document.documentElement);
  const next = Object.fromEntries(TOKENS.map((t) => [t, cs.getPropertyValue(`--${t}`).trim()])) as ChartColors;
  if (cached && TOKENS.every((t) => cached![t] === next[t])) return cached;
  cached = next;
  return next;
}

function subscribe(notify: () => void): () => void {
  const onChange = () => { dirty = true; notify(); };
  const mo = new MutationObserver(onChange);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class", "style"] });
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", onChange);
  return () => { mo.disconnect(); mq.removeEventListener("change", onChange); };
}

/** `null` on the server, where there is no computed style to read. */
export function useChartColors(): ChartColors | null {
  return useSyncExternalStore(subscribe, read, () => null);
}

/** A plot colour (`COLOR_VAR` key) as a literal. */
export function plotColor(colors: ChartColors, key: "accent" | "up" | "down" | "muted" | "ink-2"): string {
  return colors[key];
}
