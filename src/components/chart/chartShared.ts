import { createContext, useContext } from "react";
import { barTime, dateOnly } from "@/lib/format";
import type { DrawingKind } from "@/lib/chart/drawings";
import type { Bar, Locale } from "@/lib/types";

export type ChartType = "candle" | "line" | "area";

/** How many clicks each tool needs before it becomes a drawing. */
export const TOOL_POINTS: Record<DrawingKind, number> = {
  hline: 1, trend: 2, fib: 2, fibext: 2, channel: 3, trade: 1,
  ray: 2, vline: 1, rect: 2, text: 1, measure: 2,
};

/**
 * The read-out stamp. Intraday bars need the clock as well as the day; daily
 * bars need only the date. The axis builds its own labels — see `XAxis`.
 */
export function stamp(t: number, locale: Locale, intraday: boolean): string {
  return intraday ? `${dateOnly(t, locale).slice(0, 5)} ${barTime(t, locale)}` : dateOnly(t, locale);
}

export interface PaneGeom {
  width: number; band: number; x: (i: number) => number;
  PAD: { left: number; right: number }; hover: number | null;
  /** Columns the plot can resolve; see `maxColumnsFor`. One value for every pane. */
  maxCols: number;
  intraday: boolean;
  /** Plot width: the pane less its margins. */
  plotW: number;
  /** Where the first visible bar sits in the drawn window: `drawView[lead]` is `view[0]`. */
  lead: number;
  /** That margin in pixels, and the column cap that keeps its density equal to the plot's. */
  bleedPx: number; drawCols: number;
}

export interface RefLine {
  price: number;
  label: string;
  dir: "up" | "down";
}

export interface CompareSeries {
  label: string;
  /** Aligned 1:1 with the full `bars` array; null where the index has no bar. */
  series: (number | null)[];
}

/**
 * The bar-length arrays the panes draw from, for one render: the visible bars,
 * the drawn ones (the visible plus a margin a pan can reveal), and the extra
 * series cut to the drawn window.
 *
 * Shared through context, never passed as props. In development React diffs
 * the props of every component it re-renders and walks into arrays, and a
 * dozen panes each handed thousands of bars cost more in that walk than in the
 * render itself.
 */
export interface ChartSeries {
  view: Bar[];
  drawView: Bar[];
  compareDraw: (number | null)[][];
  breadth: { pct: (number | null)[]; pctDraw: (number | null)[] } | null;
  foreign: { net: (number | null)[]; netDraw: (number | null)[] } | null;
}

export const ChartSeriesContext = createContext<ChartSeries | null>(null);

export function useChartSeries(): ChartSeries {
  const series = useContext(ChartSeriesContext);
  if (!series) throw new Error("A chart pane rendered outside ChartPro.");
  return series;
}
