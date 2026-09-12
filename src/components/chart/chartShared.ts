import { barTime, dateOnly } from "@/lib/format";
import type { DrawingKind } from "@/lib/chart/drawings";
import type { Locale } from "@/lib/types";

export type { ChartTypeId as ChartType } from "@/lib/chart/chart-types";

/** How many clicks each tool needs before it becomes a drawing. */
export const TOOL_POINTS: Record<DrawingKind, number> = {
  hline: 1, trend: 2, fib: 2, fibext: 2, channel: 3, trade: 1,
  ray: 2, vline: 1, rect: 2, text: 1, measure: 2,
};

/**
 * The read-out stamp. Intraday bars need the clock as well as the day; daily
 * bars need only the date.
 */
export function stamp(t: number, locale: Locale, intraday: boolean): string {
  return intraday ? `${dateOnly(t, locale).slice(0, 5)} ${barTime(t, locale)}` : dateOnly(t, locale);
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
