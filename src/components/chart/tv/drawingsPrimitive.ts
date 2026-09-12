import type {
  IChartApi, IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesApi, ISeriesPrimitive, ISeriesPrimitiveAxisView,
  Logical, SeriesAttachedParameter, SeriesType, Time,
} from "lightweight-charts";
import type { CanvasRenderingTarget2D } from "fancy-canvas";
import {
  anchorsOf, channelParallel, fibLevels, hitAnchor, hitTest, trendPriceAt, type Drawing,
} from "@/lib/chart/drawings";
import { isSettled, settlementDate, unrealisedPct } from "@/lib/chart/settlement";
import type { Bar } from "@/lib/types";
import type { ChartColors } from "../chartColors";
import { dashPattern } from "@/lib/chart/drawing-style";
import { withAlpha } from "./color";

/** How close a press must be, as a share of the pane, to grab a drawing or one of its handles. */
const HIT_TOLERANCE = 0.012;
const ANCHOR_TOLERANCE = 0.02;

/** What one paint drew, for the interaction harness; published only when it opts in. */
export interface PaintLog {
  drawn: { k: string; x?: number; y?: number; labels?: string[]; edges?: number[][]; filled?: boolean }[];
  handles: number;
}

export interface DrawingScene {
  drawings: Drawing[];
  selectedId: string | null;
  /** The drawing being dragged, drawn in place of its stored self. */
  draft: Drawing | null;
  /** A tool's clicks so far, and the shape the next click would make. */
  pending: { t: number; p: number }[];
  preview: Drawing | null;
  colors: ChartColors;
  font: string;
  price: (p: number) => string;
  pct: (v: number) => string;
  onPaint?: (log: PaintLog) => void;
  /** Whether anyone is reading the log; building it every frame would cost a reader for nothing. */
  tracing?: () => boolean;
}

type Ctx = CanvasRenderingContext2D;

/** Drawings painted by the price series itself, so they move in the same frame as the candles under them. */
export class DrawingsPrimitive implements ISeriesPrimitive<Time> {
  private chart: IChartApi | null = null;
  private series: ISeriesApi<SeriesType> | null = null;
  private request: (() => void) | null = null;
  private bars: Bar[] = [];
  private scene: DrawingScene | null = null;
  private size = { width: 0, height: 0 };
  private log: PaintLog | null = null;
  private widths = new Map<string, number>();
  private widthFont = "";
  private readonly view: IPrimitivePaneView;

  constructor() {
    const renderer: IPrimitivePaneRenderer = {
      draw: (target: CanvasRenderingTarget2D) => target.useMediaCoordinateSpace(({ context, mediaSize }) => {
        this.size = { width: mediaSize.width, height: mediaSize.height };
        this.paint(context);
      }),
    };
    this.view = { zOrder: () => "top", renderer: () => renderer };
  }

  attached({ chart, series, requestUpdate }: SeriesAttachedParameter<Time>): void {
    this.chart = chart;
    this.series = series;
    this.request = requestUpdate;
  }

  detached(): void {
    this.chart = null; this.series = null; this.request = null;
  }

  setBars(bars: Bar[]): void { this.bars = bars; }

  setScene(scene: DrawingScene): void {
    this.scene = scene;
    this.request?.();
  }

  paneViews(): readonly IPrimitivePaneView[] { return [this.view]; }

  priceAxisViews(): readonly ISeriesPrimitiveAxisView[] {
    const s = this.scene;
    if (!s) return [];
    const list = s.draft ? s.drawings.map((d) => (d.id === s.draft!.id ? s.draft! : d)) : s.drawings;
    return list.flatMap((d) => {
      if (d.kind !== "hline") return [];
      const y = this.y(d.price);
      if (y === null) return [];
      return [{
        coordinate: () => y, text: () => s.price(d.price),
        textColor: () => s.colors.surface, backColor: () => d.style?.color ?? s.colors.accent, visible: () => true,
      }];
    });
  }

  /** Seconds between bars at the newest end; how far-off times are spaced. */
  private bucket(): number {
    const n = this.bars.length;
    return n > 1 ? this.bars[n - 1].t - this.bars[n - 2].t : 86_400;
  }

  /** A time as a fractional bar index, extrapolated past either end of the data. */
  private logicalOf(t: number): number {
    const b = this.bars, n = b.length;
    if (!n) return 0;
    if (t <= b[0].t) return (t - b[0].t) / this.bucket();
    if (t >= b[n - 1].t) return n - 1 + (t - b[n - 1].t) / this.bucket();
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (b[mid].t <= t) lo = mid; else hi = mid;
    }
    return lo + (t - b[lo].t) / (b[hi].t - b[lo].t);
  }

  x(t: number): number | null {
    return this.chart?.timeScale().logicalToCoordinate(this.logicalOf(t) as Logical) ?? null;
  }

  y(p: number): number | null {
    return this.series?.priceToCoordinate(p) ?? null;
  }

  /** The time under an x; snapped to the nearest bar unless `exact`. */
  timeAt(x: number, exact = false): number | null {
    const logical = this.chart?.timeScale().coordinateToLogical(x);
    const b = this.bars, n = b.length;
    if (logical === null || logical === undefined || !n) return null;
    const l = exact ? logical : Math.round(logical);
    if (l <= 0) return b[0].t + l * this.bucket();
    if (l >= n - 1) return b[n - 1].t + (l - (n - 1)) * this.bucket();
    const lo = Math.floor(l);
    return b[lo].t + (l - lo) * (b[lo + 1].t - b[lo].t);
  }

  priceAt(y: number): number | null {
    return this.series?.coordinateToPrice(y) ?? null;
  }

  private norm() {
    const { width, height } = this.size;
    return {
      t: (v: number) => (this.x(v) ?? 0) / (width || 1),
      p: (v: number) => (this.y(v) ?? 0) / (height || 1),
    };
  }

  /** The drawing under a point and which handle of the selected one, if any. */
  hit(px: number, py: number, drawings: Drawing[], selectedId: string | null): { drawing: Drawing; anchor: number } | null {
    const t = this.timeAt(px, true), p = this.priceAt(py);
    if (t === null || p === null) return null;
    const norm = this.norm();
    const chosen = selectedId ? drawings.find((d) => d.id === selectedId) ?? null : null;
    const anchor = chosen ? hitAnchor(chosen, t, p, norm, ANCHOR_TOLERANCE) : -1;
    if (chosen && anchor >= 0) return { drawing: chosen, anchor };
    const hit = hitTest(drawings, t, p, norm, HIT_TOLERANCE);
    return hit ? { drawing: hit, anchor: -1 } : null;
  }

  private note(entry: PaintLog["drawn"][number]): void {
    const r = (v: number) => Math.round(v * 10) / 10;
    this.log?.drawn.push({
      ...entry,
      ...(entry.x !== undefined ? { x: r(entry.x) } : {}),
      ...(entry.y !== undefined ? { y: r(entry.y) } : {}),
    });
  }

  private paint(ctx: Ctx): void {
    const s = this.scene;
    if (!s || !this.bars.length) return;
    this.log = s.onPaint && s.tracing?.() ? { drawn: [], handles: 0 } : null;
    ctx.save();
    ctx.font = s.font;
    if (this.widthFont !== s.font) { this.widths.clear(); this.widthFont = s.font; }
    ctx.lineJoin = "round";
    for (const d of s.drawings) {
      const shown = s.draft && s.draft.id === d.id ? s.draft : d;
      this.drawOne(ctx, s, shown, 1);
    }
    const log = this.log;
    this.log = null;
    if (s.preview) this.drawOne(ctx, s, s.preview, 0.6);
    this.log = log;
    const sel = s.draft && s.draft.id === s.selectedId ? s.draft : s.drawings.find((d) => d.id === s.selectedId);
    if (sel) this.handles(ctx, s, sel);
    for (const pt of s.pending) {
      const x = this.x(pt.t), y = this.y(pt.p);
      if (x === null || y === null) continue;
      this.dot(ctx, x, y, 4, s.colors.accent);
    }
    ctx.restore();
    if (this.log) s.onPaint?.(this.log);
    this.log = null;
  }

  private handles(ctx: Ctx, s: DrawingScene, d: Drawing): void {
    const { width, height } = this.size;
    for (const a of anchorsOf(d)) {
      const x = a.axis === "price" ? width - 24 : this.x(a.t);
      const y = a.axis === "time" ? height / 2 : this.y(a.p);
      if (x === null || y === null) continue;
      ctx.beginPath();
      ctx.arc(x, y, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = s.colors.surface;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = s.colors.accent;
      ctx.stroke();
      if (this.log) this.log.handles++;
    }
  }

  private dot(ctx: Ctx, x: number, y: number, r: number, color: string): void {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }

  private line(ctx: Ctx, x1: number, y1: number, x2: number, y2: number, color: string, width = 1.5, dash: number[] = []): void {
    ctx.beginPath();
    ctx.setLineDash(dash);
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.lineWidth = width;
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  private width(ctx: Ctx, text: string): number {
    let w = this.widths.get(text);
    if (w === undefined) {
      w = ctx.measureText(text).width;
      // Labels change on every frame of a fib or measure drag, so the cache is bounded rather than kept whole.
      if (this.widths.size > 500) this.widths.clear();
      this.widths.set(text, w);
    }
    return w;
  }

  /** Whether a y is on the pane, with room for a label; text off it costs a frame for nothing. */
  private visible(y: number): boolean {
    return y > -20 && y < this.size.height + 20;
  }

  private label(ctx: Ctx, s: DrawingScene, text: string, x: number, y: number, color: string, align: CanvasTextAlign = "left"): void {
    if (!this.visible(y)) return;
    ctx.textAlign = align;
    ctx.textBaseline = "middle";
    const w = this.width(ctx, text);
    const left = align === "center" ? x - w / 2 : align === "right" ? x - w : x;
    ctx.fillStyle = withAlpha(s.colors.page, 0.85);
    ctx.fillRect(left - 2, y - 7, w + 4, 14);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  }

  private drawOne(ctx: Ctx, s: DrawingScene, d: Drawing, alpha: number): void {
    const { width, height } = this.size;
    const c = s.colors;
    ctx.globalAlpha = alpha;
    const accent = d.style?.color ?? c.accent;
    const w = (fallback: number) => d.style?.width ?? fallback;
    const dash = (fallback: number[]) => (d.style?.dash ? dashPattern(d.style.dash) : fallback);
    switch (d.kind) {
      case "hline": {
        const y = this.y(d.price);
        if (y !== null) {
          this.line(ctx, 0, y, width, y, accent, w(1), dash([4, 3]));
          this.note({ k: d.kind, y });
        }
        break;
      }
      case "vline": {
        const x = this.x(d.t);
        if (x !== null) {
          this.line(ctx, x, 8, x, height - 8, accent, w(1), dash([4, 3]));
          this.note({ k: d.kind, x });
        }
        break;
      }
      case "text": {
        const x = this.x(d.t), y = this.y(d.price);
        if (x === null || y === null || !this.visible(y)) break;
        this.dot(ctx, x, y, 2.5, accent);
        ctx.textAlign = "left";
        ctx.textBaseline = "alphabetic";
        ctx.fillStyle = accent;
        ctx.fillText(d.text, x + 5, y - 4);
        this.note({ k: d.kind, x, y, labels: [d.text] });
        break;
      }
      case "trade": {
        const x = this.x(d.t), y = this.y(d.price);
        if (x === null || y === null || !this.visible(y)) break;
        const last = this.bars[this.bars.length - 1];
        const move = unrealisedPct(d.price, last.c);
        this.line(ctx, 0, y, width, y, withAlpha(c["ink-2"], 0.8), 1, [6, 2]);
        const moveText = `${move >= 0 ? "▲ +" : "▼ "}${s.pct(move)}% · ${s.price(d.price)}`;
        this.label(ctx, s, moveText, 4, y - 9, c["ink-2"]);
        this.note({ k: d.kind, x, y, labels: [moveText] });
        ctx.beginPath();
        ctx.moveTo(x, y - 5); ctx.lineTo(x + 5, y); ctx.lineTo(x, y + 5); ctx.lineTo(x - 5, y); ctx.closePath();
        ctx.fillStyle = c["ink-2"];
        ctx.fill();
        // VN shares settle T+2, credited after lunch: dashed until then, solid once sellable.
        const settle = settlementDate(d.t);
        const xs = this.x(settle);
        if (xs !== null && xs > x) {
          this.line(ctx, xs, 8, xs, height - 8, withAlpha(c["ink-2"], 0.55), 1, isSettled(d.t, last.t) ? [] : [2, 4]);
        }
        break;
      }
      default:
        this.drawSegmentKind(ctx, s, d, width);
    }
    ctx.globalAlpha = 1;
  }

  private drawSegmentKind(ctx: Ctx, s: DrawingScene, d: Drawing, width: number): void {
    if (!("t1" in d)) return;
    const c = s.colors, accent = d.style?.color ?? c.accent;
    const lw = d.style?.width ?? 1.5, dash = d.style?.dash ? dashPattern(d.style.dash) : [];
    const x1 = this.x(d.t1), x2 = this.x(d.t2), y1 = this.y(d.p1), y2 = this.y(d.p2);
    if (x1 === null || x2 === null || y1 === null || y2 === null) return;
    switch (d.kind) {
      case "trend":
        this.note({ k: d.kind, edges: [[x1, y1, x2, y2]] });
        this.line(ctx, x1, y1, x2, y2, accent, lw, dash);
        this.dot(ctx, x1, y1, 3, accent); this.dot(ctx, x2, y2, 3, accent);
        return;
      case "ray": {
        const slope = x2 !== x1 ? (y2 - y1) / (x2 - x1) : 0;
        const xe = x2 >= x1 ? width : 0;
        this.note({ k: d.kind, edges: [[x1, y1, xe, y1 + slope * (xe - x1)]] });
        this.line(ctx, x1, y1, xe, y1 + slope * (xe - x1), accent, lw, dash);
        this.dot(ctx, x1, y1, 3, accent);
        return;
      }
      case "rect": {
        const l = Math.min(x1, x2), t = Math.min(y1, y2);
        ctx.fillStyle = withAlpha(accent, 0.08);
        ctx.fillRect(l, t, Math.max(1, Math.abs(x2 - x1)), Math.max(1, Math.abs(y2 - y1)));
        ctx.lineWidth = d.style?.width ?? 1;
        ctx.strokeStyle = accent;
        ctx.setLineDash(dash);
        ctx.strokeRect(l, t, Math.max(1, Math.abs(x2 - x1)), Math.max(1, Math.abs(y2 - y1)));
        ctx.setLineDash([]);
        this.note({ k: d.kind, edges: [[x1, y1, x2, y2]], filled: true });
        return;
      }
      case "measure": {
        const dp = d.p2 - d.p1;
        const up = dp >= 0;
        ctx.fillStyle = withAlpha(up ? c.up : c.down, 0.1);
        ctx.fillRect(Math.min(x1, x2), Math.min(y1, y2), Math.max(1, Math.abs(x2 - x1)), Math.max(1, Math.abs(y2 - y1)));
        this.line(ctx, x1, y1, x2, y2, c["ink-2"], 1, [3, 2]);
        const bars = Math.round(Math.abs(this.logicalOf(d.t2) - this.logicalOf(d.t1)));
        const pctMove = d.p1 ? (dp / d.p1) * 100 : 0;
        const text = `${up ? "▲ +" : "▼ "}${s.price(Math.abs(dp))} (${up ? "+" : "-"}${s.pct(Math.abs(pctMove))}%) · ${bars}`;
        this.label(ctx, s, text, (x1 + x2) / 2, Math.min(y1, y2) - 10, c["ink-2"], "center");
        this.note({ k: d.kind, edges: [[x1, y1, x2, y2]], labels: [text], filled: true });
        return;
      }
      case "channel": {
        const par = channelParallel(d);
        const pa = this.y(trendPriceAt(par, d.t1)), pb = this.y(trendPriceAt(par, d.t2));
        const x3 = this.x(d.t3), y3 = this.y(d.p3);
        if (pa === null || pb === null) return;
        ctx.beginPath();
        ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineTo(x2, pb); ctx.lineTo(x1, pa); ctx.closePath();
        ctx.fillStyle = withAlpha(accent, 0.08);
        ctx.fill();
        this.line(ctx, x1, y1, x2, y2, accent, lw, dash);
        this.line(ctx, x1, pa, x2, pb, accent, lw, dash);
        this.note({ k: d.kind, edges: [[x1, y1, x2, y2], [x1, pa, x2, pb]], filled: true });
        this.dot(ctx, x1, y1, 3, accent); this.dot(ctx, x2, y2, 3, accent);
        if (x3 !== null && y3 !== null) this.dot(ctx, x3, y3, 3, accent);
        return;
      }
      case "fib":
      case "fibext": {
        const from = Math.min(x1, x2);
        this.line(ctx, x1, y1, x2, y2, c.muted, 1, [2, 2]);
        const texts: string[] = [];
        for (const l of fibLevels(d)) {
          const y = this.y(l.price);
          if (y === null || !this.visible(y)) continue;
          // 50% and 61.8% are the levels traders watch; the rest recede.
          const key = l.ratio === 0.5 || l.ratio === 0.618;
          const text = `${(l.ratio * 100).toFixed(1).replace(/[.]0$/, "")}% · ${s.price(l.price)}`;
          const w = this.width(ctx, text);
          this.line(ctx, Math.min(from + w + 8, width), y, width, y, withAlpha(accent, key ? 0.9 : 0.45), key ? 1.4 : 1);
          ctx.globalAlpha = key ? 1 : 0.75;
          this.label(ctx, s, text, from + 2, y, accent);
          ctx.globalAlpha = 1;
          texts.push(text);
        }
        this.note({ k: d.kind, edges: [[x1, y1, x2, y2]], labels: texts });
        this.dot(ctx, x1, y1, 3, accent); this.dot(ctx, x2, y2, 3, accent);
        return;
      }
    }
  }
}
