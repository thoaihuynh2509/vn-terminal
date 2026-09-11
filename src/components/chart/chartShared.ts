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
  view: Bar[]; width: number; band: number; x: (i: number) => number;
  PAD: { left: number; right: number }; hover: number | null;
  /** Columns the plot can resolve; see `maxColumnsFor`. One value for every pane. */
  maxCols: number;
  intraday: boolean;
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
