"use client";

import { useSyncExternalStore } from "react";

/** The tokens a canvas layer paints with. SVG reads these as `var(--…)`; canvas cannot. */
const TOKENS = ["up", "down", "surface", "accent", "muted", "ink-2", "grid", "ink", "line", "page", "axis", "up-text", "down-text", "accent-text"] as const;
export type ChartToken = (typeof TOKENS)[number];
/** The chart paints in TradingView's palette, which the workspace tokens carry for both themes. */
const TV_VAR: Record<ChartToken, string> = {
  up: "--tv-up", down: "--tv-down", surface: "--tv-bg", accent: "--tv-accent", muted: "--tv-cross",
  "ink-2": "--tv-text-2", grid: "--tv-grid", ink: "--tv-label", line: "--tv-border", page: "--tv-bg", axis: "--tv-text",
  "up-text": "--tv-up-text", "down-text": "--tv-down-text", "accent-text": "--tv-accent-text",
};
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
  const next = Object.fromEntries(TOKENS.map((t) => [t, cs.getPropertyValue(TV_VAR[t]).trim()])) as ChartColors;
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

/** A plot's colour for text beside it: the same hue, at a strength small type can be read at. */
export function textColor(colors: ChartColors, key: "accent" | "up" | "down" | "muted" | "ink-2"): string {
  return key === "accent" ? colors["accent-text"] : key === "up" ? colors["up-text"] : key === "down" ? colors["down-text"] : colors["ink-2"];
}
