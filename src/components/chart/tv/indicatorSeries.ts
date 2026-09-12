import {
  HistogramSeries, LineSeries, LineStyle,
  type IChartApi, type IPriceLine, type ISeriesApi, type UTCTimestamp,
} from "lightweight-charts";
import { INDICATORS, type IndicatorDef, type Plot } from "@/lib/ta/registry";
import { effectivePeriod, parseRef } from "@/lib/ta/params";
import { sameHead } from "@/lib/chart/series-align";
import type { Bar } from "@/lib/types";
import type { ChartColors } from "../chartColors";
import { withAlpha } from "./color";

export interface ActiveIndicator {
  token: string;
  def: IndicatorDef;
  period: number | null;
  plots: Plot[];
  /** Values in shares or VND, printed compactly. */
  format?: "volume";
  /** False for a pane the page switches on (foreign flow, breadth), not the indicator menu. */
  removable?: boolean;
}

/** Computed once over the whole loaded series, never per window, so a bar reads the same at every zoom. */
export function computeIndicators(active: string[], bars: Bar[]): ActiveIndicator[] {
  const out: ActiveIndicator[] = [];
  for (const token of active) {
    const ref = parseRef(token);
    const def = ref ? INDICATORS.find((d) => d.id === ref.id) : undefined;
    if (!ref || !def) continue;
    out.push({ token, def, period: ref.period, plots: def.compute(bars, effectivePeriod(def, ref.period)) });
  }
  return out;
}

function plotPoint(plot: Plot, b: Bar, i: number, up: string, down: string) {
  const time = b.t as UTCTimestamp;
  const v = plot.series[i];
  if (v === null || v === undefined || !Number.isFinite(v)) return { time };
  return plot.style === "histogram" ? { time, value: v, color: v >= 0 ? up : down } : { time, value: v };
}

type PlotSeries = ISeriesApi<"Line"> | ISeriesApi<"Histogram">;
interface Entry { series: PlotSeries[]; guides: IPriceLine[] }

/** Indicators as engine series, one pane per oscillator; rebuilt only when the set or the theme changes. */
export class IndicatorLayer {
  private entries = new Map<string, Entry>();
  private shape = "";
  private colors: ChartColors | null = null;
  private sent = new Map<string, { n: number; t0: number; series: Plot["series"][] }>();

  constructor(private chart: IChartApi, private formatters: { value: (v: number) => string; volume: (v: number) => string }) {}

  sync(list: ActiveIndicator[], bars: Bar[], colors: ChartColors): void {
    const shape = list.map((a) => a.token).join("|");
    if (shape !== this.shape || colors !== this.colors) {
      this.clear();
      this.build(list, colors);
      this.shape = shape;
      this.colors = colors;
    }
    const n = bars.length, t0 = bars[0]?.t ?? 0;
    const up = withAlpha(colors.up, 0.6), down = withAlpha(colors.down, 0.6);
    for (const a of list) {
      const e = this.entries.get(a.token);
      if (!e) continue;
      const prev = this.sent.get(a.token);
      // A replay step or a live tick changes only the newest bar; anything else is sent whole.
      const tail = !!prev && n > 0 && prev.t0 === t0 && (n === prev.n || n === prev.n + 1)
        && a.plots.every((p, j) => sameHead(prev.series[j], p.series, n - 1));
      a.plots.forEach((p, j) => {
        const s = e.series[j];
        if (!s) return;
        if (tail) s.update(plotPoint(p, bars[n - 1], n - 1, up, down));
        else s.setData(bars.map((b, i) => plotPoint(p, b, i, up, down)));
      });
      this.sent.set(a.token, { n, t0, series: a.plots.map((p) => p.series) });
    }
  }

  /** Oscillator panes in use, below the price pane. */
  get oscillators(): number {
    return [...this.entries.keys()].length ? this.chart.panes().length - 1 : 0;
  }

  clear(): void {
    for (const e of this.entries.values()) for (const s of e.series) this.chart.removeSeries(s);
    this.entries.clear();
    this.sent.clear();
    this.shape = "";
  }

  private build(list: ActiveIndicator[], colors: ChartColors): void {
    let pane = 0;
    for (const a of list) {
      const { def } = a;
      const osc = def.pane === "oscillator";
      const paneIndex = osc ? ++pane : 0;
      const fixed = def.range;
      const format = def.id === "obv" || a.format === "volume" ? this.formatters.volume : this.formatters.value;
      const common = {
        priceLineVisible: false,
        lastValueVisible: osc,
        priceFormat: { type: "custom" as const, formatter: format, minMove: 0.01 },
        ...(fixed ? { autoscaleInfoProvider: () => ({ priceRange: { minValue: fixed[0], maxValue: fixed[1] } }) } : {}),
      };
      const series = a.plots.map((p): PlotSeries => {
        const color = colors[p.color];
        if (p.style === "histogram") return this.chart.addSeries(HistogramSeries, { ...common, color }, paneIndex);
        return this.chart.addSeries(LineSeries, {
          ...common, color: p.style === "band" ? withAlpha(color, 0.75) : color,
          lineWidth: p.style === "band" ? 1 : 2, crosshairMarkerVisible: osc,
        }, paneIndex);
      });
      const guides = (def.guides ?? []).map((price) => series[0].createPriceLine({
        price, color: withAlpha(colors.muted, 0.8), lineWidth: 1, lineStyle: LineStyle.Dashed,
        axisLabelVisible: false, lineVisible: true, title: "",
      }));
      this.entries.set(a.token, { series, guides });
    }
  }
}
