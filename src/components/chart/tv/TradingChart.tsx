"use client";

import { useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  AreaSeries, BarSeries, BaselineSeries, CandlestickSeries, ColorType, CrosshairMode, HistogramSeries, LineSeries, LineStyle,
  LineType, PriceScaleMode,
  TickMarkType, createChart, createSeriesMarkers,
  type IChartApi, type IPriceLine, type ISeriesApi, type LogicalRange, type MouseEventParams, type SeriesType,
  type Time, type UTCTimestamp,
} from "lightweight-charts";
import type { Dict } from "@/lib/i18n";
import { num, volume as fmtVol } from "@/lib/format";
import { INDICATORS, type IndicatorDef, type Plot } from "@/lib/ta/registry";
import { clampPeriod, formatRef, labelFor, sameIndicator } from "@/lib/ta/params";
import { INDICATOR_LIMIT, can } from "@/lib/auth/entitlement";
import { DEFAULT_VIEW, mergeViewIntoQuery, type ChartView } from "@/lib/chart/view-state";
import { barsForRange, rangeForCount, type TvRange } from "@/lib/chart/range-interval";
import { DEFAULT_APPEARANCE, snapToBar, type Appearance } from "@/lib/chart/appearance";
import { isReplayDone, replayBars, startReplay, stepReplay, type Replay } from "@/lib/chart/replay";
import { DEFAULT_SCALE, type ScaleId } from "@/lib/chart/scale";
import { DEFAULT_SETTINGS, SETTINGS_KEY, parseSettings, restorable, serializeSettings, type ChartSettings } from "@/lib/chart/settings";
import { heikinAshi } from "@/lib/chart/chart-types";
import { tickLabel, type TickKind } from "@/lib/chart/ticks";
import { olderLead } from "@/lib/chart/history-window";
import { useStored, writeStored } from "@/lib/browser-store";
import { track } from "@/lib/analytics/posthog";
import { EVENT_GLYPH, placeEvents, type CorpEvent, type PlacedEvent } from "@/lib/chart/events";
import { alignByTime, sameHead } from "@/lib/chart/series-align";
import { linkedIndex } from "@/lib/chart/sync";
import { alertKind, parseAlerts, STORAGE_KEY as ALERTS_KEY } from "@/lib/alerts/alerts";
import type { Bar, Locale, Tier } from "@/lib/types";
import { textColor, useChartColors, type ChartColors } from "../chartColors";
import { useSeriesBars } from "../useSeriesBars";
import { createValueStore, useStoreValue, type ValueStore } from "../valueStore";
import { BarTable } from "../BarTable";
import { PeriodChip } from "../PeriodChip";
import { GateHint, type Gate } from "../GateHint";
import { useChartSync } from "../ChartSync";
import { useDrawingStore } from "../useDrawingStore";
import { TOOL_POINTS, stamp } from "../chartShared";
import { DrawingsPrimitive } from "./drawingsPrimitive";
import { DrawingStyleBar } from "./DrawingStyleBar";
import { ReplayBar } from "./ReplayBar";
import { MAX_TEXT_LEN, moveAnchor, newId, translate, withDraft, type Drawing, type DrawingKind } from "@/lib/chart/drawings";
import { isEditable } from "@/lib/chart/tf-keys";
import type { ChartType, CompareSeries, RefLine } from "../chartShared";
import { withAlpha } from "./color";
import { WorkspaceContext } from "./store";
import { IndicatorLayer, computeIndicators, type ActiveIndicator } from "./indicatorSeries";

export type { CompareSeries, RefLine } from "../chartShared";

export interface TradingChartProps {
  bars: Bar[];
  symbol: string;
  locale: Locale;
  dict: Dict;
  tier: Tier;
  digits?: number;
  /** Minute/hour bars need a clock on the axis; daily bars need a date. */
  intraday?: boolean;
  /** VN ceiling/floor (trần/sàn), drawn as price lines on the axis. */
  refLines?: RefLine[];
  compare?: CompareSeries[];
  foreign?: CompareSeries | null;
  breadth?: CompareSeries | null;
  events?: CorpEvent[];
  /** The view a shared link carried, already decoded and clamped server-side. */
  initialView?: ChartView;
  /** Interval id, for the legend and the exported image's name. */
  tf?: string;
  exchange?: string | null;
  /** The primary chart drives the workspace's toolbars; a grid cell is a legend and a chart. */
  role?: "primary" | "cell";
}

/** Bars shown when a link names no range. */
const DEFAULT_COUNT = 120;
/** Room kept right of the last bar, in bars, as TradingView leaves it. */
const RIGHT_OFFSET = 4;
const ICT = "Asia/Ho_Chi_Minh";
/** Compare overlays keep the dash order they always had, so each stays distinguishable without colour. */
const CMP_STYLE = [LineStyle.Dashed, LineStyle.Dotted, LineStyle.LargeDashed] as const;
const CMP_NAME = ["dashed", "dotted", "largedashed"] as const;
const TICK_KIND: Record<TickMarkType, TickKind> = {
  [TickMarkType.Year]: "year", [TickMarkType.Month]: "month", [TickMarkType.DayOfMonth]: "day",
  [TickMarkType.Time]: "time", [TickMarkType.TimeWithSeconds]: "seconds",
};
const NO_REFS: RefLine[] = [];
const NO_COMPARE: CompareSeries[] = [];
const NO_EVENTS: CorpEvent[] = [];

const SCALE_MODE: Record<ScaleId, PriceScaleMode> = {
  lin: PriceScaleMode.Normal, log: PriceScaleMode.Logarithmic, pct: PriceScaleMode.Percentage,
};

const time = (t: number) => t as UTCTimestamp;

/** A pane the page switches on rather than the indicator menu, drawn like an oscillator. */
function extraPane(id: string, plot: Plot, opts: { guides: number[]; range?: [number, number]; format?: "volume" }): ActiveIndicator {
  const def: IndicatorDef = {
    id, label: plot.label, short: plot.label, pane: "oscillator", group: "volume", free: true,
    guides: opts.guides, range: opts.range, compute: () => [],
  };
  return { token: id, def, period: null, plots: [plot], format: opts.format, removable: false };
}

function eventLabel(ev: PlacedEvent, dict: Dict, locale: Locale): string {
  const label = ev.kind === "cash" ? dict.chart.eventCash : ev.kind === "stock" ? dict.chart.eventStock : dict.chart.eventRights;
  const amount = ev.cash !== null ? ` · ${num(ev.cash, locale, 0)} ₫/cp` : ev.ratio !== null ? ` · ${num(ev.ratio, locale, 1)}%` : "";
  return `${EVENT_GLYPH[ev.kind]} ${label}${amount} · ${dict.chart.eventExDate} ${ev.exDate}`;
}

/** The drawing a tool's points make, or null while it still needs more. Channel previews as its baseline. */
function shapeFrom(kind: DrawingKind, pts: { t: number; p: number }[], id: string): Drawing | null {
  const [a, b, c] = pts;
  if (!a) return null;
  if (kind === "hline") return { id, kind, price: a.p };
  if (kind === "vline") return { id, kind, t: a.t };
  if (kind === "trade") return { id, kind, t: a.t, price: a.p };
  if (kind === "text" || !b) return null;
  const seg = { id, t1: a.t, p1: a.p, t2: b.t, p2: b.p };
  if (kind === "channel") return c ? { ...seg, kind, t3: c.t, p3: c.p } : { ...seg, kind: "trend" };
  return kind === "trend" ? { ...seg, kind }
    : kind === "fib" ? { ...seg, kind }
    : kind === "fibext" ? { ...seg, kind }
    : kind === "ray" ? { ...seg, kind }
    : kind === "rect" ? { ...seg, kind }
    : { ...seg, kind: "measure" };
}

function ohlc(bars: Bar[]) {
  return bars.map((b) => ({ time: time(b.t), open: b.o, high: b.h, low: b.l, close: b.c }));
}

function mainData(type: ChartType, bars: Bar[], c: ChartColors | null) {
  const up = c?.up, down = c?.down;
  if (type === "heikin") return ohlc(heikinAshi(bars));
  if (type === "candle" || type === "hollow" || type === "bars") return ohlc(bars);
  // High-low: a bar from low to high and nothing else, drawn as a body with no wick.
  if (type === "highlow") {
    return bars.map((b) => ({ time: time(b.t), open: b.h, high: b.h, low: b.l, close: b.l, color: b.c >= b.o ? up : down, borderColor: b.c >= b.o ? up : down }));
  }
  if (type === "columns") {
    return bars.map((b, i) => ({ time: time(b.t), value: b.c, color: b.c >= (bars[i - 1]?.c ?? b.o) ? up : down }));
  }
  return bars.map((b) => ({ time: time(b.t), value: b.c }));
}

function volumeData(bars: Bar[], c: ChartColors) {
  const up = withAlpha(c.up, 0.45), down = withAlpha(c.down, 0.45);
  return bars.map((b) => ({ time: time(b.t), value: b.v, color: b.c >= b.o ? up : down }));
}

/** The chart, on TradingView's Lightweight Charts, with what a VN reader needs on top. */
export function TradingChart(props: TradingChartProps) {
  const {
    bars: barsProp, symbol, locale, dict, tier, digits = 2, intraday = false,
    refLines = NO_REFS, compare = NO_COMPARE, foreign = null, breadth = null, events = NO_EVENTS,
    initialView = DEFAULT_VIEW, tf = "1D", exchange = null, role = "primary",
  } = props;
  const theme = useChartColors();
  const limit = INDICATOR_LIMIT[tier];
  const unlocked = can(tier, "chart:indicators");

  const storedSettings = useStored(SETTINGS_KEY);
  const saved = useMemo(() => {
    const parsed = parseSettings(storedSettings);
    if (!parsed) return null;
    return restorable(
      parsed,
      limit,
      (id) => INDICATORS.some((d) => d.id === id),
      (id) => unlocked || !!INDICATORS.find((d) => d.id === id)?.free,
    );
  }, [storedSettings, limit, unlocked]);
  // Precedence: this session's choice, then the link, then the stored setup.
  const [typeChoice, setTypeChoice] = useState<ChartType | null>(null);
  const [scaleChoice, setScaleChoice] = useState<ScaleId | null>(null);
  const [activeChoice, setActiveChoice] = useState<string[] | null>(null);
  const type = typeChoice ?? initialView.type ?? saved?.type ?? DEFAULT_SETTINGS.type;
  const scale = scaleChoice
    ?? (initialView.scale !== DEFAULT_SCALE ? initialView.scale : null)
    ?? saved?.scale ?? DEFAULT_SETTINGS.scale;
  const active = activeChoice
    ?? (initialView.ind.length ? initialView.ind : null)
    ?? (saved?.indicators.length ? saved.indicators : DEFAULT_SETTINGS.indicators);
  const persist = useCallback((next: Partial<ChartSettings>) => {
    const current = parseSettings(storedSettings) ?? DEFAULT_SETTINGS;
    writeStored(SETTINGS_KEY, serializeSettings({ ...current, ...next }));
  }, [storedSettings]);
  const appearance = useMemo(() => parseSettings(storedSettings)?.appearance ?? DEFAULT_APPEARANCE, [storedSettings]);
  const setAppearance = useCallback((a: Appearance) => persist({ appearance: a }), [persist]);
  const colors = useMemo<ChartColors | null>(
    () => theme && {
      ...theme, up: appearance.upColor || theme.up, down: appearance.downColor || theme.down,
      "up-text": appearance.upColor || theme["up-text"], "down-text": appearance.downColor || theme["down-text"],
    },
    [theme, appearance.upColor, appearance.downColor],
  );

  const [gate, setGate] = useState<{ gate: Gate; limit?: number; asked?: boolean; n: number } | null>(null);
  const gateSeq = useRef(0);
  // A sequence number remounts the hint each time, even when one gate fires twice.
  const raiseGate = useCallback((g: { gate: Gate; limit?: number; asked?: boolean }) => {
    gateSeq.current += 1;
    setGate({ ...g, n: gateSeq.current });
  }, []);

  // Two clicks in one render batch must compose, so the handlers read the committed set from a ref.
  const activeRef = useRef(active);
  useEffect(() => { activeRef.current = active; }, [active]);
  const toggle = useCallback((def: IndicatorDef) => {
    if (!def.free && !unlocked) {
      track("chart_limit_hit", { gate: "indicator", reason: "locked", id: def.id, tier, limit });
      raiseGate({ gate: "indicator", limit });
      return;
    }
    const prev = activeRef.current;
    const on = prev.some((t) => sameIndicator(t, def.id));
    if (!on && prev.length >= limit) {
      track("chart_limit_hit", { gate: "indicator", reason: "limit", id: def.id, tier, limit });
      raiseGate({ gate: "indicator", limit });
      return;
    }
    const next = on ? prev.filter((t) => !sameIndicator(t, def.id)) : [...prev, def.id];
    activeRef.current = next;
    setActiveChoice(next);
    persist({ indicators: next });
    track("chart_indicator_toggled", { id: def.id, on: !on, active_count: next.length, limit, tier });
  }, [limit, unlocked, tier, persist, raiseGate]);
  const setPeriod = useCallback((def: IndicatorDef, period: number) => {
    if (!def.param) return;
    const p = clampPeriod(def, period);
    const next = activeRef.current.map((t) => (sameIndicator(t, def.id) ? formatRef({ id: def.id, period: p }, def) : t));
    activeRef.current = next;
    setActiveChoice(next);
    persist({ indicators: next });
    track("chart_indicator_tuned", { id: def.id, period: p, tier });
  }, [persist, tier]);

  const canDraw = can(tier, "chart:drawings");
  const { drawings, selectedId, setSelectedId, histFlags, commitDrawings, addDrawing, deleteSelected, stepHistory } =
    useDrawingStore({ symbol, tier, raiseGate });
  const [mode, setMode] = useState<"cursor" | DrawingKind>("cursor");
  const [pending, setPending] = useState<{ t: number; p: number }[]>([]);
  const [noteAt, setNoteAt] = useState<{ t: number; p: number; x: number; y: number } | null>(null);
  const noteOpen = useRef(false);

  const rootRef = useRef<HTMLDivElement>(null);
  const [asTable, setAsTable] = useState(false);
  const [away, setAway] = useState(false);
  // The engine's visible window: how many bars, and whether its left edge is
  // close enough to the oldest loaded bar to ask for more.
  const [edge, setEdge] = useState({ near: false, count: DEFAULT_COUNT, oldest: 0 });
  const gesture = useRef(false);
  const isBusy = useCallback(() => gesture.current, []);
  const { bars: loaded, releaseHeld } = useSeriesBars({ barsProp, symbol, tf, isBusy, edge });
  // A replay belongs to the series it was started on; another symbol or interval opens live.
  const replayKey = `${symbol}:${tf}`;
  const [replaying, setReplaying] = useState<{ key: string; replay: Replay | null; picking: boolean }>(
    { key: replayKey, replay: null, picking: false },
  );
  const { replay, picking } = replaying.key === replayKey ? replaying : { replay: null, picking: false };
  const setReplay = useCallback((next: (r: Replay | null) => Replay | null) => {
    setReplaying((s) => ({ key: replayKey, picking: false, replay: next(s.key === replayKey ? s.replay : null) }));
  }, [replayKey]);
  const setPicking = useCallback((on: boolean) => {
    setReplaying((s) => ({ key: replayKey, picking: on, replay: s.key === replayKey ? s.replay : null }));
  }, [replayKey]);
  const replayOn = picking || replay !== null;
  const toggleReplay = useCallback(() => {
    setReplaying((s) => ({ key: replayKey, replay: null, picking: !(s.key === replayKey && (s.picking || s.replay !== null)) }));
  }, [replayKey]);
  const loadedRef = useRef(loaded);
  useEffect(() => { loadedRef.current = loaded; }, [loaded]);
  const pickReplay = useCallback((t: number) => setReplay(() => startReplay(loadedRef.current, t)), [setReplay]);
  const playing = !!replay?.playing, speed = replay?.speed ?? 1;
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setReplay((r) => (r ? stepReplay(r, loadedRef.current) : r)), 1000 / speed);
    return () => clearInterval(id);
  }, [playing, speed, setReplay]);
  const replayT = replay?.t ?? null;
  const bars = useMemo(() => replayBars(loaded, replayT === null ? null : { t: replayT }), [loaded, replayT]);
  const releaseRef = useRef(releaseHeld);
  useEffect(() => { releaseRef.current = releaseHeld; }, [releaseHeld]);
  const indicators = useMemo(() => computeIndicators(active, bars), [active, bars]);
  // The server's extra series match its own bars 1:1; the chart has since prepended history.
  const compareAligned = useMemo(
    () => compare.map((c) => ({ label: c.label, series: alignByTime(barsProp, c.series, bars) })),
    [compare, barsProp, bars],
  );
  const extras = useMemo(() => {
    const out: ActiveIndicator[] = [];
    if (foreign) {
      out.push(extraPane("x:foreign", {
        key: "foreign", label: foreign.label, series: alignByTime(barsProp, foreign.series, bars), style: "histogram", color: "muted",
      }, { guides: [0], format: "volume" }));
    }
    if (breadth) {
      out.push(extraPane("x:breadth", {
        key: "breadth", label: breadth.label, series: alignByTime(barsProp, breadth.series, bars), style: "line", color: "accent",
      }, { guides: [50], range: [0, 100] }));
    }
    return out;
  }, [foreign, breadth, barsProp, bars]);
  const panes = useMemo(() => [...extras, ...indicators], [extras, indicators]);
  const placed = useMemo(() => placeEvents(bars, events), [bars, events]);
  const eventText = useMemo(() => new Map(placed.map((ev) => [ev.i, eventLabel(ev, dict, locale)])), [placed, dict, locale]);
  const storedAlerts = useStored(ALERTS_KEY);
  // An indicator alert's level is an RSI reading, not a price, so it has no place on the price pane.
  const alerts = useMemo(
    () => parseAlerts(storedAlerts).filter((a) => a.symbol === symbol.toUpperCase() && alertKind(a) !== "indicator"),
    [storedAlerts, symbol],
  );
  const linkId = useId();
  const publishRef = useRef<(t: number | null) => void>(() => {});

  const [hover] = useState(() => createValueStore<number | null>(null));
  // Bars in view change on every zoom notch; only the label, the range buttons and the URL read them.
  const [shown] = useState(() => createValueStore(DEFAULT_COUNT));
  const [cursor] = useState(() => createValueStore<number | null>(null));
  // Only the bottom bar reads the bars; a store keeps a new bar from re-rendering every toolbar.
  const [barsStore] = useState(() => createValueStore<Bar[]>([]));
  useEffect(() => { barsStore.set(bars); }, [barsStore, bars]);
  const barsLen = useRef(0);
  const traceRef = useRef<() => void>(() => {});
  const [paneTops, setPaneTops] = useState<number[]>([0]);
  const hostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const mainRef = useRef<ISeriesApi<SeriesType> | null>(null);
  const volRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const layerRef = useRef<IndicatorLayer | null>(null);
  const shownRef = useRef<Bar[]>([]);
  const shownKey = useRef("");
  const seeded = useRef(false);
  const linesRef = useRef<IPriceLine[]>([]);
  const primRef = useRef<DrawingsPrimitive | null>(null);
  const draftRef = useRef<Drawing | null>(null);
  const previewRef = useRef<Drawing | null>(null);
  const repaint = useRef<() => void>(() => {});

  /** Where each pane starts inside the host, for the legends laid over them. */
  const measurePanes = useCallback(() => {
    const chart = chartRef.current, host = hostRef.current;
    if (!chart || !host) return;
    const top = host.getBoundingClientRect().top;
    const next = chart.panes().map((p) => Math.round((p.getHTMLElement()?.getBoundingClientRect().top ?? top) - top));
    setPaneTops((prev) => (prev.length === next.length && prev.every((v, i) => v === next[i]) ? prev : next));
  }, []);

  // The engine, once per mount.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const lang = locale === "vi" ? "vi-VN" : "en-GB";
    const stampFmt = new Intl.DateTimeFormat(lang, {
      timeZone: ICT, weekday: "short", day: "2-digit", month: "2-digit", year: "2-digit",
      ...(intraday ? { hour: "2-digit", minute: "2-digit", hourCycle: "h23" } : {}),
    });
    const ticks = new Map<number, string>();
    const pct = new Set<string>();
    let traceTimer: ReturnType<typeof setTimeout> | undefined;
    const signedPct = (v: number) => `${v >= 0 ? "+" : ""}${num(v, locale, 2)}%`;
    const chart = createChart(host, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        attributionLogo: true,
        fontFamily: getComputedStyle(host).fontFamily,
        fontSize: 11,
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { scaleMargins: { top: 0.08, bottom: 0.22 } },
      timeScale: {
        rightOffset: RIGHT_OFFSET, timeVisible: intraday, secondsVisible: false,
        tickMarkFormatter: (t: Time, kind: TickMarkType) => {
          const label = tickLabel(t as number, TICK_KIND[kind], locale);
          ticks.set(t as number, label);
          return label;
        },
      },
      // No chart-wide priceFormatter: it would override every series' own format, OBV's volume units included.
      localization: {
        timeFormatter: (t: Time) => stampFmt.format(new Date((t as number) * 1000)),
        percentageFormatter: signedPct,
        tickmarksPercentageFormatter: (vs: number[]) => vs.map((v) => {
          const label = signedPct(v);
          // Read back by the harness, and bounded: a long session in percent mode would otherwise grow it for good.
          if (pct.size > 500) pct.clear();
          pct.add(label);
          return label;
        }),
      },
    });
    // The engine lays its panes out in a table; it is layout, not data, inside an image.
    host.querySelector("table")?.setAttribute("role", "presentation");
    const vol = chart.addSeries(HistogramSeries, {
      priceScaleId: "vol", priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false,
    });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    chartRef.current = chart;
    volRef.current = vol;
    layerRef.current = new IndicatorLayer(chart, {
      value: (v) => num(v, locale, 2),
      volume: (v) => fmtVol(v, locale),
    });
    // Canvas has no nodes to query, so with `data-trace="1"` (the harness's opt-in) the chart publishes what it painted.
    const publish = () => {
      if (host.dataset.trace !== "1") return;
      const now = chart.timeScale().getVisibleRange();
      if (now) {
        const inView = [...ticks].filter(([t]) => t >= (now.from as number) && t <= (now.to as number)).sort((a, b) => a[0] - b[0]);
        host.dataset.ticks = JSON.stringify(inView.map(([, l]) => l));
      }
      const main = mainRef.current, h = chart.paneSize(0).height;
      if (main && h) host.dataset.scale = JSON.stringify([0.2, 0.4, 0.6, 0.8].map((f) => main.coordinateToPrice(h * f)));
      host.dataset.pct = JSON.stringify([...pct]);
      repaint.current();
    };
    const schedule = () => {
      if (host.dataset.trace !== "1") return;
      clearTimeout(traceTimer);
      traceTimer = setTimeout(publish, 150);
    };
    traceRef.current = () => { pct.clear(); schedule(); };
    const mo = new MutationObserver(schedule);
    mo.observe(host, { attributes: true, attributeFilter: ["data-trace"] });
    const onCross = (p: MouseEventParams) => {
      hover.set(p.logical ?? null);
      const main = mainRef.current;
      cursor.set(p.point && (p.paneIndex ?? 0) === 0 && main ? main.coordinateToPrice(p.point.y) : null);
      // Only a real pointer publishes to the grid; a crosshair set from another cell must not echo back.
      if (p.sourceEvent) publishRef.current(p.time === undefined ? null : (p.time as number));
    };
    chart.subscribeCrosshairMove(onCross);
    const onLeave = () => publishRef.current(null);
    host.addEventListener("pointerleave", onLeave);
    // Ctrl+wheel is the browser's page zoom, an accessibility affordance; the chart leaves it alone.
    const onWheel = (e: WheelEvent) => { if (e.ctrlKey) e.stopPropagation(); };
    host.addEventListener("wheel", onWheel, { capture: true });
    const onRange = (r: LogicalRange | null) => {
      if (!r) return;
      // Bars in view: the window clipped to the loaded series at both ends.
      const count = Math.max(1, Math.min(r.to, barsLen.current - 1) - Math.max(r.from, 0) + 1);
      shown.set(Math.round(count));
      // A view already holding every loaded bar ("Tất cả") is the whole series, not a pan nearing its edge.
      const all = r.from <= 0 && r.to >= barsLen.current - 1;
      const near = !all && r.from < olderLead(count);
      const oldest = shownRef.current[0]?.t ?? 0;
      setEdge((e) => (e.near === near && e.oldest === oldest ? e : { near, count, oldest }));
      const tr = chart.timeScale().getVisibleRange();
      // Read by the perf and interaction harness; written directly so a pan never renders React.
      if (tr) host.dataset.window = `${tr.from}:${tr.to}`;
      setAway(r.to < barsLen.current - 1);
      schedule();
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(onRange);
    const ro = new ResizeObserver(() => requestAnimationFrame(measurePanes));
    ro.observe(host);
    return () => {
      ro.disconnect();
      mo.disconnect();
      clearTimeout(traceTimer);
      host.removeEventListener("pointerleave", onLeave);
      host.removeEventListener("wheel", onWheel, { capture: true });
      chart.unsubscribeCrosshairMove(onCross);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRange);
      chart.remove();
      chartRef.current = null; mainRef.current = null; volRef.current = null; layerRef.current = null;
      shownRef.current = []; shownKey.current = ""; seeded.current = false; linesRef.current = [];
    };
  }, [locale, digits, intraday, hover, cursor, shown, measurePanes]);

  // The price series, rebuilt when its type changes.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const common = {
      priceLineStyle: LineStyle.Dotted,
      priceFormat: { type: "custom" as const, formatter: (p: number) => num(p, locale, digits), minMove: 10 ** -digits },
    };
    const series = (type === "bars" ? chart.addSeries(BarSeries, { ...common, thinBars: false })
      : type === "line" || type === "step" ? chart.addSeries(LineSeries, { ...common, lineType: type === "step" ? LineType.WithSteps : LineType.Simple })
      : type === "area" ? chart.addSeries(AreaSeries, common)
      : type === "baseline" ? chart.addSeries(BaselineSeries, common)
      : type === "columns" ? chart.addSeries(HistogramSeries, common)
      : chart.addSeries(CandlestickSeries, common)) as ISeriesApi<SeriesType>;
    if (shownRef.current.length) series.setData(mainData(type, shownRef.current, null));
    mainRef.current = series;
    const prim = new DrawingsPrimitive();
    series.attachPrimitive(prim);
    primRef.current = prim;
    if (hostRef.current) hostRef.current.dataset.series = type;
    linesRef.current = [];
    return () => {
      // The engine's own cleanup runs first on unmount and has already removed the chart.
      if (chartRef.current === chart) {
        series.detachPrimitive(prim);
        chart.removeSeries(series);
      }
      if (primRef.current === prim) primRef.current = null;
      if (mainRef.current === series) mainRef.current = null;
      linesRef.current = [];
    };
  }, [type, locale, digits, intraday]);

  // Colours from the app's own tokens, re-read when the theme flips.
  useEffect(() => {
    const chart = chartRef.current, series = mainRef.current, vol = volRef.current;
    if (!chart || !series || !vol || !colors) return;
    chart.applyOptions({
      layout: {
        textColor: colors["ink-2"],
        panes: { separatorColor: colors.line, separatorHoverColor: withAlpha(colors.accent, 0.25) },
      },
      grid: { vertLines: { color: colors.grid, visible: appearance.grid }, horzLines: { color: colors.grid, visible: appearance.grid } },
      crosshair: {
        mode: appearance.magnet ? CrosshairMode.MagnetOHLC : CrosshairMode.Normal,
        vertLine: { color: colors.muted, labelBackgroundColor: colors.ink },
        horzLine: { color: colors.muted, labelBackgroundColor: colors.ink },
      },
      rightPriceScale: { borderColor: colors.line },
      timeScale: { borderColor: colors.line },
    });
    if (type === "candle" || type === "heikin") {
      series.applyOptions({
        upColor: colors.up, downColor: colors.down, wickUpColor: colors.up, wickDownColor: colors.down, borderVisible: false,
      });
    } else if (type === "hollow") {
      series.applyOptions({
        upColor: "rgba(0, 0, 0, 0)", downColor: colors.down, borderVisible: true, borderUpColor: colors.up, borderDownColor: colors.down,
        wickUpColor: colors.up, wickDownColor: colors.down,
      });
    } else if (type === "highlow") {
      series.applyOptions({ wickVisible: false, borderVisible: false });
    } else if (type === "bars") {
      series.applyOptions({ upColor: colors.up, downColor: colors.down });
    } else if (type === "baseline") {
      const closes = shownRef.current.map((b) => b.c);
      const mid = closes.length ? (Math.max(...closes) + Math.min(...closes)) / 2 : 0;
      series.applyOptions({
        baseValue: { type: "price", price: mid },
        topLineColor: colors.up, topFillColor1: withAlpha(colors.up, 0.28), topFillColor2: withAlpha(colors.up, 0.05),
        bottomLineColor: colors.down, bottomFillColor1: withAlpha(colors.down, 0.05), bottomFillColor2: withAlpha(colors.down, 0.28),
      });
    } else if (type === "area") {
      series.applyOptions({
        lineColor: colors.accent, topColor: withAlpha(colors.accent, 0.28), bottomColor: withAlpha(colors.accent, 0.02), lineWidth: 2,
      });
    } else {
      series.applyOptions({ color: colors.accent, lineWidth: 2 });
    }
    if (shownRef.current.length) vol.setData(volumeData(shownRef.current, colors));
    vol.applyOptions({ visible: appearance.volume });
    // Columns and high-low carry a colour per bar, so a theme change re-sets their data.
    if ((type === "columns" || type === "highlow") && shownRef.current.length) series.setData(mainData(type, shownRef.current, colors));
  }, [colors, type, locale, digits, intraday, appearance.grid, appearance.magnet, appearance.volume]);

  // A new series is set whole; a page of older bars keeps the view where it was;
  // the forming bar is updated in place.
  useEffect(() => {
    const chart = chartRef.current, series = mainRef.current, vol = volRef.current;
    if (!chart || !series || !vol) return;
    // Two HOSE symbols share their trading days, so bar times alone cannot tell a new series from a live bar.
    const key = `${symbol}|${tf}`;
    if (shownKey.current !== key) {
      shownKey.current = key;
      shownRef.current = [];
      seeded.current = false;
    }
    const prev = shownRef.current;
    shownRef.current = bars;
    barsLen.current = bars.length;
    if (!bars.length) return;
    const ts = chart.timeScale();
    const sameStart = prev.length > 0 && prev[0].t === bars[0].t;
    if (sameStart && bars.length >= prev.length && bars.length - prev.length <= 1) {
      const last = bars[bars.length - 1];
      // A Heikin Ashi or column bar depends on the one before it, so the tail is taken from the whole series.
      const data = mainData(type, bars, colors);
      series.update(data[data.length - 1]);
      if (colors) vol.update(volumeData([last], colors)[0]);
      return;
    }
    const kept = prev.length ? bars.findIndex((b) => b.t === prev[0].t) : -1;
    const before = ts.getVisibleLogicalRange();
    series.setData(mainData(type, bars, colors));
    if (colors) vol.setData(volumeData(bars, colors));
    if (kept > 0 && before) {
      ts.setVisibleLogicalRange({ from: before.from + kept, to: before.to + kept });
    } else if (!seeded.current) {
      seeded.current = true;
      if (initialView.range === "ALL") ts.fitContent();
      else {
        const count = initialView.range ? barsForRange(bars, initialView.range) : DEFAULT_COUNT;
        ts.setVisibleLogicalRange({ from: bars.length - count, to: bars.length - 1 + RIGHT_OFFSET });
      }
    }
  }, [bars, type, colors, initialView.range, symbol, tf, locale, digits, intraday]);

  // Indicators: overlays on the price pane, one pane per oscillator.
  useEffect(() => {
    const chart = chartRef.current, layer = layerRef.current;
    if (!chart || !layer || !colors || !bars.length) return;
    layer.sync(panes, bars, colors);
    const oscillators = chart.panes().length - 1;
    chart.panes().forEach((p, k) => p.setStretchFactor(k === 0 ? Math.max(3, oscillators * 0.8) : 1));
    const raf = requestAnimationFrame(measurePanes);
    return () => cancelAnimationFrame(raf);
  }, [panes, bars, colors, measurePanes, type, locale, digits, intraday]);

  // Compare overlays, each on a hidden scale of its own: shape without moving the price axis.
  const cmpCount = compareAligned.length;
  const cmpSeries = useRef<ISeriesApi<"Line">[]>([]);
  const cmpSent = useRef<{ n: number; t0: number; series: ReturnType<typeof alignByTime>[] } | null>(null);
  useEffect(() => {
    const chart = chartRef.current, host = hostRef.current;
    if (host) host.dataset.compare = Array.from({ length: cmpCount }, (_, i) => CMP_NAME[i % CMP_NAME.length]).join("|");
    if (!chart || !colors || !cmpCount) return;
    const made = Array.from({ length: cmpCount }, (_, i) => {
      const id = `cmp${i}`;
      const s = chart.addSeries(LineSeries, {
        priceScaleId: id, color: withAlpha(colors.muted, 0.85), lineWidth: 2, lineStyle: CMP_STYLE[i % CMP_STYLE.length],
        priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
      });
      chart.priceScale(id).applyOptions({ scaleMargins: { top: 0.08, bottom: 0.22 } });
      return s;
    });
    cmpSeries.current = made;
    cmpSent.current = null;
    return () => {
      cmpSeries.current = [];
      if (chartRef.current === chart) for (const s of made) chart.removeSeries(s);
    };
  }, [cmpCount, colors, locale, digits, intraday]);
  useEffect(() => {
    const made = cmpSeries.current, n = bars.length;
    if (!made.length || !n) return;
    const prev = cmpSent.current, t0 = bars[0].t;
    const point = (v: number | null | undefined, t: number) =>
      (v === null || v === undefined || !Number.isFinite(v) ? { time: time(t) } : { time: time(t), value: v });
    compareAligned.forEach((c, i) => {
      const s = made[i];
      if (!s) return;
      if (prev && prev.t0 === t0 && (n === prev.n || n === prev.n + 1) && sameHead(prev.series[i], c.series, n - 1)) {
        s.update(point(c.series[n - 1], bars[n - 1].t));
      } else {
        s.setData(bars.map((b, j) => point(c.series[j], b.t)));
      }
    });
    cmpSent.current = { n, t0, series: compareAligned.map((c) => c.series) };
  }, [compareAligned, bars, cmpCount, colors, locale, digits, intraday]);

  // Corporate events under the bars they fall on; the legend names the one under the crosshair.
  useEffect(() => {
    const series = mainRef.current;
    if (!series || !colors || !placed.length) return;
    const plugin = createSeriesMarkers(series, placed.map((ev) => ({
      time: time(bars[ev.i].t), position: "belowBar" as const, shape: "circle" as const, color: colors.muted, text: EVENT_GLYPH[ev.kind],
    })));
    return () => {
      if (mainRef.current === series) plugin.detach();
    };
  }, [placed, bars, colors, type, locale, digits, intraday]);

  // Ceiling and floor on the price axis.
  useEffect(() => {
    const series = mainRef.current;
    if (!series || !colors) return;
    for (const l of linesRef.current) series.removePriceLine(l);
    linesRef.current = refLines.map((r) => series.createPriceLine({
      price: r.price, color: r.dir === "up" ? colors.up : colors.down, lineWidth: 1,
      lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: r.label,
    }));
    if (hostRef.current) hostRef.current.dataset.alerts = String(alerts.length);
    for (const a of alerts) {
      const rising = a.condition === "above" || a.condition === "cross_up";
      linesRef.current.push(series.createPriceLine({
        price: a.price, color: withAlpha(colors.accent, a.triggeredAt ? 0.45 : 0.9), lineWidth: 1,
        lineStyle: LineStyle.SparseDotted, axisLabelVisible: true, title: rising ? "▲" : "▼",
      }));
    }
  }, [refLines, alerts, colors, type, locale, digits, intraday]);

  useEffect(() => {
    chartRef.current?.priceScale("right").applyOptions({ mode: SCALE_MODE[scale] });
    traceRef.current();
  }, [scale, locale, digits, intraday]);

  // Drawings: what React knows, handed to the primitive; a drag repaints it directly.
  useEffect(() => {
    const prim = primRef.current, host = hostRef.current;
    if (!prim || !host || !colors) return;
    prim.setBars(bars);
    if (!pending.length) previewRef.current = null;
    const font = `11px ${getComputedStyle(host).fontFamily}`;
    const prices = new Map<number, string>();
    const price = (p: number) => {
      let text = prices.get(p);
      if (text === undefined) {
        text = num(p, locale, digits);
        prices.set(p, text);
      }
      return text;
    };
    const onPaint = (log: object) => {
      const json = JSON.stringify(log);
      if (host.dataset.drawn !== json) host.dataset.drawn = json;
    };
    repaint.current = () => prim.setScene({
      drawings, selectedId, draft: draftRef.current, pending, preview: previewRef.current, colors, font,
      price, pct: (v) => num(v, locale, 2), onPaint,
      tracing: () => host.dataset.trace === "1",
    });
    repaint.current();
  }, [bars, drawings, selectedId, pending, colors, type, locale, digits, intraday]);

  // With a tool armed a drag places points, so the chart stops panning; the wheel still zooms.
  useEffect(() => {
    chartRef.current?.applyOptions({ handleScroll: mode === "cursor" });
    previewRef.current = null;
    repaint.current();
  }, [mode, locale, digits, intraday]);

  const live = useRef({ mode, pending, drawings, selectedId, addDrawing, commitDrawings, picking, magnet: appearance.magnet, bars, pickReplay });
  useEffect(() => {
    live.current = { mode, pending, drawings, selectedId, addDrawing, commitDrawings, picking, magnet: appearance.magnet, bars, pickReplay };
  });

  useEffect(() => {
    const host = hostRef.current, chart = chartRef.current;
    if (!host || !chart) return;
    let press: { x: number; y: number } | null = null;
    let edit: { anchor: number; t0: number; p0: number; orig: Drawing; moved: boolean } | null = null;
    const snap = (t: number, p: number) => {
      if (!live.current.magnet) return p;
      const bar = live.current.bars.find((b) => b.t === t);
      return bar ? snapToBar(bar, p) : p;
    };
    const at = (e: PointerEvent) => {
      const r = host.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      const size = chart.paneSize(0);
      return { x, y, inPane: x >= 0 && x < size.width && y >= 0 && y < size.height };
    };
    const onDown = (e: PointerEvent) => {
      if (e.button === 0) gesture.current = true;
      const prim = primRef.current;
      const pt = at(e);
      if (e.button !== 0 || !pt.inPane || !prim) return;
      press = { x: pt.x, y: pt.y };
      if (live.current.mode !== "cursor") return;
      const hit = prim.hit(pt.x, pt.y, live.current.drawings, live.current.selectedId);
      const t0 = prim.timeAt(pt.x), p0 = prim.priceAt(pt.y);
      if (!hit || t0 === null || p0 === null) return;
      // Claimed before the engine sees the press, so it moves the drawing instead of panning.
      e.preventDefault();
      e.stopPropagation();
      chart.applyOptions({ handleScroll: false });
      host.focus({ preventScroll: true });
      host.setPointerCapture(e.pointerId);
      setSelectedId(hit.drawing.id);
      edit = { anchor: hit.anchor, t0, p0, orig: hit.drawing, moved: false };
    };
    const onMove = (e: PointerEvent) => {
      const prim = primRef.current;
      if (!prim) return;
      const pt = at(e);
      const t = prim.timeAt(pt.x), p = prim.priceAt(pt.y);
      if (t === null || p === null) return;
      if (edit) {
        draftRef.current = edit.anchor >= 0 ? moveAnchor(edit.orig, edit.anchor, t, p) : translate(edit.orig, t - edit.t0, p - edit.p0);
        edit.moved = true;
        repaint.current();
        return;
      }
      const { mode: m, pending: pts } = live.current;
      if (m === "cursor" || !pts.length) return;
      previewRef.current = shapeFrom(m, [...pts, { t, p: snap(t, p) }], "preview");
      repaint.current();
    };
    const onUp = (e: PointerEvent) => {
      gesture.current = false;
      releaseRef.current();
      const start = press;
      press = null;
      if (edit) {
        const ed = edit;
        edit = null;
        if (host.hasPointerCapture(e.pointerId)) host.releasePointerCapture(e.pointerId);
        chart.applyOptions({ handleScroll: live.current.mode === "cursor" });
        const final = draftRef.current;
        draftRef.current = null;
        if (ed.moved && final && e.type !== "pointercancel") {
          track("chart_drawing_edited", { kind: final.kind, anchor: ed.anchor, symbol });
          live.current.commitDrawings(withDraft(live.current.drawings, final));
        } else {
          repaint.current();
        }
        return;
      }
      const prim = primRef.current;
      if (!start || !prim || e.type === "pointercancel") return;
      const pt = at(e);
      if (Math.hypot(pt.x - start.x, pt.y - start.y) > 4) return;
      const { mode: m, pending: pts, addDrawing: add } = live.current;
      const t = prim.timeAt(pt.x), raw = prim.priceAt(pt.y);
      if (m === "cursor") {
        if (live.current.picking && t !== null) live.current.pickReplay(t);
        else setSelectedId(null);
        return;
      }
      if (t === null || raw === null) return;
      const p = snap(t, raw);
      if (m === "text") {
        noteOpen.current = true;
        setNoteAt({ t, p, x: pt.x, y: pt.y });
        return;
      }
      const next = [...pts, { t, p }];
      if (next.length < TOOL_POINTS[m]) {
        setPending(next);
        return;
      }
      const id = newId();
      const shape = shapeFrom(m, next, id);
      previewRef.current = null;
      setPending([]);
      setMode("cursor");
      if (shape && add(shape)) setSelectedId(id);
    };
    host.addEventListener("pointerdown", onDown, true);
    host.addEventListener("pointermove", onMove);
    host.addEventListener("pointerup", onUp);
    host.addEventListener("pointercancel", onUp);
    return () => {
      host.removeEventListener("pointerdown", onDown, true);
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("pointerup", onUp);
      host.removeEventListener("pointercancel", onUp);
    };
  }, [locale, digits, intraday, symbol, setSelectedId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isEditable(document.activeElement) || !rootRef.current?.contains(document.activeElement)) return;
      const mod = e.metaKey || e.ctrlKey;
      if (e.key === "Escape") {
        setPending([]);
        setMode("cursor");
        setSelectedId(null);
      } else if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
        e.preventDefault();
        deleteSelected();
      } else if (mod && e.key.toLowerCase() === "z" && (e.shiftKey ? histFlags.redo : histFlags.undo)) {
        e.preventDefault();
        stepHistory(e.shiftKey ? "redo" : "undo");
      } else if (mod && e.key.toLowerCase() === "y" && histFlags.redo) {
        e.preventDefault();
        stepHistory("redo");
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selectedId, deleteSelected, stepHistory, setSelectedId, histFlags]);

  const commitNote = (raw: string) => {
    if (!noteOpen.current) return;
    noteOpen.current = false;
    const spot = noteAt;
    setNoteAt(null);
    setMode("cursor");
    const text = raw.trim().slice(0, MAX_TEXT_LEN);
    if (!spot || !text) return;
    const id = newId();
    if (addDrawing({ id, kind: "text", t: spot.t, price: spot.p, text })) setSelectedId(id);
  };

  const pickRange = useCallback((id: TvRange) => {
    const ts = chartRef.current?.timeScale();
    if (!ts) return;
    if (id === "ALL") ts.fitContent();
    else {
      const count = barsForRange(bars, id);
      ts.setVisibleLogicalRange({ from: bars.length - count, to: bars.length - 1 + RIGHT_OFFSET });
    }
    track("chart_range_changed", { range: id });
  }, [bars]);

  const shoot = useCallback(() => {
    const chart = chartRef.current, host = hostRef.current;
    if (!chart || !host) return null;
    return { canvas: chart.takeScreenshot(true, false), cssWidth: host.clientWidth };
  }, []);

  // The engine applies a new window on its next frame, so a held key chains from the one last asked for.
  const keyRange = useRef<{ from: number; to: number } | null>(null);
  const onHostKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const chart = chartRef.current, series = mainRef.current;
    if (!chart || !series || !bars.length) return;
    const ts = chart.timeScale();
    const r = keyRange.current ?? ts.getVisibleLogicalRange();
    const go = (next: { from: number; to: number }) => {
      if (!keyRange.current) requestAnimationFrame(() => { keyRange.current = null; });
      keyRange.current = next;
      ts.setVisibleLogicalRange(next);
    };
    if (e.shiftKey && (e.key === "ArrowLeft" || e.key === "ArrowRight") && r) {
      e.preventDefault();
      const step = Math.max(1, Math.round((r.to - r.from) / 4)) * (e.key === "ArrowLeft" ? -1 : 1);
      go({ from: r.from + step, to: r.to + step });
    } else if ((e.key === "+" || e.key === "=" || e.key === "-") && r) {
      e.preventDefault();
      const mid = (r.from + r.to) / 2;
      const half = ((r.to - r.from) * (e.key === "-" ? 1.25 : 0.8)) / 2;
      go({ from: mid - half, to: mid + half });
    } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      const base = hover.get() ?? bars.length - 1;
      const i = Math.max(0, Math.min(bars.length - 1, Math.round(base) + (e.key === "ArrowRight" ? 1 : -1)));
      chart.setCrosshairPosition(bars[i].c, time(bars[i].t), series);
      hover.set(i);
    }
  };

  const goTo = useCallback((target: number) => {
    const ts = chartRef.current?.timeScale();
    const r = ts?.getVisibleLogicalRange();
    if (!ts || !r || !bars.length) return;
    const i = Math.max(0, bars.findIndex((b) => b.t >= target));
    const half = (r.to - r.from) / 2;
    ts.setVisibleLogicalRange({ from: i - half, to: i + half });
  }, [bars]);

  const clearDrawings = useCallback(() => { commitDrawings([]); setPending([]); setSelectedId(null); }, [commitDrawings, setSelectedId]);
  const ws = useContext(WorkspaceContext);
  const setType = useCallback((t: ChartType) => {
    setTypeChoice(t); persist({ type: t }); track("chart_type_changed", { type: t });
  }, [persist]);
  const setScale = useCallback((sc: ScaleId) => {
    setScaleChoice(sc); persist({ scale: sc }); track("chart_scale_changed", { scale: sc });
  }, [persist]);
  useEffect(() => {
    if (!ws || role !== "primary") return;
    ws.set({
      dict, tier, symbol, tf, type, setType, scale, setScale, active, toggle, limit, unlocked,
      mode, setMode, setPending, canDraw, raiseGate, histFlags, stepHistory, selectedId, deleteSelected,
      hasDrawings: drawings.length > 0,
      clearDrawings,
      shown, bars: barsStore, pickRange, goTo, shoot, asTable, setAsTable,
      appearance, setAppearance, themeUp: theme?.up ?? "", themeDown: theme?.down ?? "", replayOn, toggleReplay,
    });
  }, [ws, role, dict, tier, symbol, tf, type, setType, scale, setScale, active, toggle, limit, unlocked, mode, canDraw, raiseGate,
    histFlags, stepHistory, selectedId, deleteSelected, drawings.length, shown, barsStore, pickRange, goTo, shoot, asTable,
    clearDrawings, appearance, setAppearance, theme, replayOn, toggleReplay]);
  const styled = drawings.find((d) => d.id === selectedId && d.kind !== "trade" && d.kind !== "measure") ?? null;
  useEffect(() => () => { if (role === "primary") ws?.set(null); }, [ws, role]);

  return (
    <div ref={rootRef} className="relative flex h-full min-h-0 flex-col">
      {role === "primary" && (
        <UrlSync shown={shown} bars={bars} view={{ type, ind: active, scale }} tf={tf} intraday={can(tier, "chart:intraday")} />
      )}
      {/* Always mounted: a region that arrives already populated is routinely not announced by NVDA and JAWS. */}
      <div role="status" aria-live="polite" className="absolute inset-x-2 top-12 z-20">
        {gate && (
          <GateHint key={gate.n} gate={gate.gate} limit={gate.limit} asked={gate.asked} locale={locale} dict={dict} tier={tier}
            onClose={() => setGate(null)} />
        )}
      </div>
      {mode === "trade" && <p className="absolute bottom-2 left-2 z-20 text-[12px] text-tv-text-2">{dict.chart.tradeHint}</p>}
      {mode !== "cursor" && pending.length > 0 && (
        <p role="status" className="absolute bottom-2 left-2 z-20 rounded bg-tv-bg px-2 py-1 text-[12px] text-tv-text shadow">
          {dict.chart.drawNeed.replace("{n}", String(TOOL_POINTS[mode] - pending.length))}
        </p>
      )}
      {asTable && (
        <div className="absolute inset-0 z-30 overflow-auto bg-tv-bg p-2">
          <BarTable bars={bars} locale={locale} dict={dict} digits={digits} intraday={intraday} />
        </div>
      )}
      <div className="relative min-h-0 flex-1 select-none">
        {bars.length > 0 && colors && (
          <Legends bars={bars} hover={hover} cursor={cursor} intraday={intraday} indicators={panes} compare={compareAligned} eventText={eventText}
            paneTops={paneTops} colors={colors} exchange={exchange} volume={appearance.volume}
            symbol={symbol} tf={tf} locale={locale} digits={digits} dict={dict} onPeriod={setPeriod} onRemove={toggle} />
        )}
        <CrosshairLink id={linkId} chartRef={chartRef} mainRef={mainRef} bars={bars} hover={hover} publishRef={publishRef} />
        <div ref={hostRef} role="img" aria-label={`${symbol} — ${dict.stocks.chartTitle}`} tabIndex={0} onKeyDown={onHostKey}
          className="h-full w-full outline-none focus-visible:ring-1 focus-visible:ring-tv-accent" />
        {noteAt && (
          <input autoFocus aria-label={dict.chart.toolTextPrompt} placeholder={dict.chart.toolTextPrompt} maxLength={MAX_TEXT_LEN}
            className="absolute z-20 w-48 rounded-md border border-tv-border bg-tv-bg px-2 py-1 text-[12px] text-tv-text shadow-lg"
            style={{ left: noteAt.x + 6, top: noteAt.y - 14 }}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitNote(e.currentTarget.value);
              if (e.key === "Escape") { noteOpen.current = false; setNoteAt(null); setMode("cursor"); }
            }}
            onBlur={(e) => commitNote(e.currentTarget.value)} />
        )}
        {away && (
          <button type="button" onClick={() => chartRef.current?.timeScale().scrollToRealTime()}
            className="absolute bottom-10 right-16 z-10 rounded-md border border-tv-border bg-tv-bg px-2.5 py-1 text-[12px] font-medium text-tv-text shadow hover:bg-tv-hover">
            {dict.chart.panBack} <span aria-hidden="true">»</span>
          </button>
        )}
        {styled && mode === "cursor" && colors && (
          <DrawingStyleBar
            labels={{
              toolbar: dict.chart.styleBar, color: dict.chart.styleColor, width: dict.chart.styleWidth,
              dash: { solid: dict.chart.dashSolid, dashed: dict.chart.dashDashed, dotted: dict.chart.dashDotted },
              remove: dict.chart.deleteSelected, colorNames: dict.chart.colorNames,
            }}
            style={styled.style} fallback={colors.accent} onDelete={deleteSelected}
            onChange={(style) => commitDrawings(drawings.map((d) => (d.id === styled.id ? { ...d, style } : d)))} />
        )}
        {role === "primary" && replayOn && (
          <ReplayBar
            labels={{
              toolbar: dict.chart.replay, pick: dict.chart.replayPick, play: dict.chart.replayPlay, pause: dict.chart.replayPause,
              step: dict.chart.replayStep, speed: dict.chart.replaySpeed, exit: dict.chart.replayExit,
            }}
            replay={replay} picking={picking} done={!!replay && isReplayDone(replay, loaded)}
            onPick={() => setPicking(!picking)}
            onToggle={() => setReplay((r) => r && { ...r, playing: !r.playing })}
            onStep={() => setReplay((r) => r && stepReplay(r, loaded))}
            onSpeed={(sp) => setReplay((r) => r && { ...r, speed: sp })}
            onExit={toggleReplay} />
        )}
      </div>
    </div>
  );
}

/** Legends over each pane; values are written into their nodes on crosshair moves, so hovering never renders React. */
function Legends({ bars, hover, cursor, intraday, indicators, compare, eventText, paneTops, colors, exchange, volume, symbol, tf, locale, digits, dict, onPeriod, onRemove }: {
  volume: boolean;
  bars: Bar[]; hover: ValueStore<number | null>; indicators: ActiveIndicator[]; paneTops: number[]; colors: ChartColors;
  /** The price under the pointer in the price pane, read against the last close. */
  cursor: ValueStore<number | null>; intraday: boolean;
  compare: { label: string; series: (number | null)[] }[]; eventText: Map<number, string>; exchange: string | null;
  symbol: string; tf: string; locale: Locale; digits: number; dict: Dict;
  onPeriod: (def: IndicatorDef, period: number) => void; onRemove: (def: IndicatorDef) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const slots = [...root.querySelectorAll<HTMLElement>("[data-lv]")];
    const price = (v: number) => num(v, locale, digits);
    const fmtFor = (a: ActiveIndicator) => (a.def.pane === "price"
      ? price
      : a.def.id === "obv" || a.format === "volume" ? (v: number) => fmtVol(v, locale) : (v: number) => num(v, locale, 2));
    const paint = () => {
      const at = hover.get();
      const i = at !== null && at >= 0 && at <= bars.length - 1 ? Math.round(at) : bars.length - 1;
      const b = bars[i];
      const prev = i > 0 ? bars[i - 1].c : b.o;
      const change = b.c - prev;
      const up = change >= 0;
      const sign = up ? "+" : "";
      for (const el of slots) {
        const key = el.dataset.lv!;
        let text: string;
        if (key === "o") text = price(b.o);
        else if (key === "h") text = price(b.h);
        else if (key === "l") text = price(b.l);
        else if (key === "c") text = price(b.c);
        else if (key === "chg") text = `${sign}${price(change)} (${sign}${num(prev ? (change / prev) * 100 : 0, locale, 2)}%)`;
        else if (key === "v") text = b.v > 0 ? fmtVol(b.v, locale) : "—";
        else if (key === "ev") text = eventText.get(i) ?? "";
        else if (key === "d") text = stamp(b.t, locale, intraday);
        else if (key === "cp") {
          const cp = cursor.get(), last = bars[bars.length - 1].c;
          const dd = cp === null || !last ? 0 : ((cp - last) / last) * 100;
          text = cp === null ? "" : `${price(cp)} · ${dd >= 0 ? "▲ +" : "▼ "}${num(dd, locale, 2)}%`;
        }
        else if (key.startsWith("cmp:")) {
          const v = compare[Number(key.slice(4))]?.series[i];
          text = v === null || v === undefined || !Number.isFinite(v) ? "—" : num(v, locale, 2);
        } else {
          const [ai, pi] = key.split(":").map(Number);
          const a = indicators[ai];
          const v = a?.plots[pi]?.series[i];
          text = v === null || v === undefined || !Number.isFinite(v) ? "—" : fmtFor(a)(v);
        }
        if (el.textContent !== text) el.textContent = text;
        if (el.dataset.dir !== undefined) el.style.color = up ? colors["up-text"] : colors["down-text"];
      }
    };
    paint();
    const offHover = hover.subscribe(paint), offCursor = cursor.subscribe(paint);
    return () => { offHover(); offCursor(); };
  }, [bars, indicators, compare, eventText, hover, cursor, intraday, locale, digits, colors]);

  const row = (a: ActiveIndicator, ai: number) => (
    <div key={a.token} className="flex items-baseline gap-2">
      <span className="pointer-events-auto">
        {a.def.param
          ? <PeriodChip def={a.def} period={a.period} dict={dict} onChange={onPeriod} color={colors["ink-2"]} />
          : <span>{labelFor(a.def, a.period)}</span>}
      </span>
      {a.plots.map((p, pi) => <span key={p.key} data-lv={`${ai}:${pi}`} style={{ color: textColor(colors, p.color) }} />)}
      {a.removable !== false && (
        <button type="button" onClick={() => onRemove(a.def)} aria-label={`${dict.chart.remove} ${labelFor(a.def, a.period)}`}
          className="pointer-events-auto inline-grid h-6 w-6 place-items-center rounded text-tv-text-2 hover:text-tv-text">×</button>
      )}
    </div>
  );
  return (
    <div ref={rootRef} className="tnum pointer-events-none absolute inset-x-2 top-0 z-10 text-[13px] text-tv-text">
      <div className="absolute left-0 top-1.5 space-y-0.5">
        <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
          <span className="text-[15px]">{symbol} · {tf}{exchange ? ` · ${exchange}` : ""}</span>
          <span data-lv="d" className="sr-only" />
          <span className="ml-2">O<span data-lv="o" data-dir="" /></span>
          <span>H<span data-lv="h" data-dir="" /></span>
          <span>L<span data-lv="l" data-dir="" /></span>
          <span>C<span data-lv="c" data-dir="" /></span>
          <span data-lv="chg" data-dir="" />
          <span data-lv="cp" className="ml-2 text-tv-text-2" />
        </div>
        <div hidden={!volume} className="flex items-baseline gap-2">
          <span>{dict.common.volume}</span>
          <span data-lv="v" style={{ color: colors["ink-2"] }} />
        </div>
        {indicators.map((a, ai) => (a.def.pane === "price" ? row(a, ai) : null))}
        {compare.map((c, k) => (
          <div key={`cmp${k}`} className="flex items-baseline gap-2">
            <span className="text-tv-text-2">{c.label}</span>
            <span data-lv={`cmp:${k}`} />
          </div>
        ))}
        <div data-lv="ev" className="text-tv-text-2" />
      </div>
      {indicators.map((a, ai) => {
        if (a.def.pane !== "oscillator") return null;
        const k = indicators.slice(0, ai).filter((x) => x.def.pane === "oscillator").length;
        return (
          <div key={a.token} className="absolute left-0" style={{ top: (paneTops[k + 1] ?? 0) + 4 }}>
            {row(a, ai)}
          </div>
        );
      })}
    </div>
  );
}

/** The grid's shared crosshair, read in this leaf so a move in one cell re-renders only this in the others. */
function CrosshairLink({ id, chartRef, mainRef, bars, hover, publishRef }: {
  id: string;
  /** Set here too: the engine fires no crosshair event for a position set in code, so the legend would not follow. */
  hover: ValueStore<number | null>;
  chartRef: RefObject<IChartApi | null>;
  mainRef: RefObject<ISeriesApi<SeriesType> | null>;
  bars: Bar[];
  publishRef: RefObject<(t: number | null) => void>;
}) {
  const { hoverT, sourceId, publish } = useChartSync();
  const linked = useRef(false);
  useEffect(() => {
    publishRef.current = (t) => publish(id, t);
  }, [publish, id, publishRef]);
  useEffect(() => {
    const chart = chartRef.current, series = mainRef.current;
    if (!chart || !series || sourceId === id) return;
    // At rest this runs on every new bar; it must not wipe a crosshair the reader placed here.
    if (hoverT === null && !linked.current) return;
    linked.current = hoverT !== null;
    const i = linkedIndex(bars, hoverT);
    if (i === null) chart.clearCrosshairPosition();
    else chart.setCrosshairPosition(bars[i].c, time(bars[i].t), series);
    hover.set(i);
  }, [hoverT, sourceId, id, bars, chartRef, mainRef, hover]);
  return null;
}

/** Keeps the address bar on the view on screen; re-renders on zoom so the chart need not. */
function UrlSync({ shown, bars, view, tf, intraday }: {
  shown: ValueStore<number>; bars: Bar[]; view: { type: ChartType; ind: string[]; scale: ScaleId }; tf: string; intraday: boolean;
}) {
  const count = useStoreValue(shown);
  const active = useMemo(() => rangeForCount(bars, count, tf, intraday), [bars, count, tf, intraday]);
  const { type, ind, scale } = view;
  useEffect(() => {
    const next = mergeViewIntoQuery(window.location.search, { type, ind, range: active, scale });
    const url = `${window.location.pathname}${next ? `?${next}` : ""}`;
    if (url !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(null, "", url);
  }, [type, ind, scale, active]);
  return null;
}
