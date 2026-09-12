/** Every chart style the workspace offers, in the order TradingView lists them. */
export const CHART_TYPES = ["bars", "candle", "hollow", "heikin", "line", "step", "area", "baseline", "columns", "highlow"] as const;
export type ChartTypeId = (typeof CHART_TYPES)[number];

export function isChartType(v: unknown): v is ChartTypeId {
  return typeof v === "string" && (CHART_TYPES as readonly string[]).includes(v);
}

/** Heikin Ashi bars: each averages its own prices with the previous body, so a run of one direction reads as one colour. */
export function heikinAshi<T extends { o: number; h: number; l: number; c: number }>(bars: T[]): T[] {
  const out: T[] = [];
  let po = 0, pc = 0;
  bars.forEach((b, i) => {
    const c = (b.o + b.h + b.l + b.c) / 4;
    const o = i === 0 ? (b.o + b.c) / 2 : (po + pc) / 2;
    out.push({ ...b, o, c, h: Math.max(b.h, o, c), l: Math.min(b.l, o, c) });
    po = o;
    pc = c;
  });
  return out;
}
