"use client";

import { startTransition, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Dict } from "@/lib/i18n";
import { INDICATORS, type IndicatorDef, type Plot } from "@/lib/ta/registry";
import { clampPeriod, effectivePeriod, formatRef, parseRef, sameIndicator } from "@/lib/ta/params";
import { GateHint, type Gate } from "./GateHint";
import { INDICATOR_LIMIT, can } from "@/lib/auth/entitlement";
import { MAX_TEXT_LEN, hitAnchor, hitTest, moveAnchor, newId, translate, type Drawing, type DrawingKind, sameDrawing, withDraft } from "@/lib/chart/drawings";
import { clampHover, maxOffset, offsetFromDrag, pinch, spreadOf, windowBounds, zoomAt } from "@/lib/chart/pan";
import { placeEvents, type CorpEvent } from "@/lib/chart/events";
import { FIRST_CHART_KEY } from "@/components/OnboardingWatchlist";
import { maxColumnsFor } from "@/lib/chart/paths";
import { linkedIndex } from "@/lib/chart/sync";
import { useChartSync } from "./ChartSync";
import { RANGE_PRESETS, barsForPreset, presetForBars, type RangePreset } from "@/lib/chart/ranges";
import { DEFAULT_VIEW, mergeViewIntoQuery, type ChartView } from "@/lib/chart/view-state";
import { DEFAULT_SCALE, denorm, effectiveScale, padRange, type ScaleId, priceExtent } from "@/lib/chart/scale";
import { useStored, writeStored } from "@/lib/browser-store";
import { DEFAULT_SETTINGS, SETTINGS_KEY, parseSettings, restorable, serializeSettings, clampPaneRatio, MIN_PANE_RATIO, MAX_PANE_RATIO } from "@/lib/chart/settings";
import { track } from "@/lib/analytics/posthog";
import { parseAlerts, STORAGE_KEY as ALERTS_KEY } from "@/lib/alerts/alerts";
import type { Bar, Locale, Tier } from "@/lib/types";
import { ChartSeriesContext, type ChartSeries, type ChartType, TOOL_POINTS, type RefLine, type CompareSeries } from "./chartShared";
import { Toolbar } from "./ChartToolbar";
import { PricePane } from "./PricePane";
import { VolumePane, ForeignPane, BreadthPane, OscillatorPane } from "./SubPanes";
import { XAxis } from "./XAxis";
import { BarTable } from "./BarTable";
import { DrawingRail } from "./DrawingRail";
import { StatusLine } from "./StatusLine";
import { useDrawingStore } from "./useDrawingStore";
import { useSeriesBars } from "./useSeriesBars";
import { PanLayersContext, createPanLayers } from "./panLayers";

/**
 * Plot margins. Module scope, not per render: a fresh object each render gave
 * every closure built from it a fresh identity, so a memo keyed on those
 * closures could never hit.
 */
const PAD = { left: 6, right: 58 } as const;

/** Share of the visible window drawn past each edge during a drag; see `drawView`. */
const BLEED = 0.3;
/** A pointer resting this long mid-drag lets the chart catch up: the axis re-fits to what is in view. */
const PAN_REST_MS = 120;

/**
 * How close a click has to be, in normalised pane units, to grab something.
 * Anchors get a wider reach than lines: a handle is a specific point a reader
 * is aiming at, and missing it drags the whole drawing instead.
 */
const HIT_TOLERANCE = 0.012;
const ANCHOR_TOLERANCE = 0.02;

const DEFAULT_RANGE = 120; // bars; 0 = everything loaded
/** Shown once, then dismissed for good. */
const HINT_KEY = "hint:chart";

/**
 * Price-pane height. The chart is the page: on a phone it takes 60% of the
 * viewport (the rail is a bottom sheet there, so nothing competes for the
 * height), on a desktop it grows with the window instead of a fixed 340px.
 */
function paneHeight(full: boolean, ratio: number | null): number {
  if (typeof window === "undefined") return 340;
  // A height the reader dragged wins over every automatic rule, including the
  // desktop ceiling — they asked for a taller chart, so they get one.
  if (ratio !== null) return Math.max(160, Math.round(window.innerHeight * clampPaneRatio(ratio)));
  if (full) return Math.max(280, window.innerHeight - 230);
  if (window.innerWidth < 1024) return Math.max(280, Math.round(window.innerHeight * 0.6));
  return Math.max(280, Math.min(520, Math.round(window.innerHeight * 0.48)));
}
export type { CompareSeries, RefLine } from "./chartShared";

/**
 * Multi-pane chart workspace.
 *
 * Panes share one x-scale and one hovered index, so the crosshair and every
 * read-out move together — a chart whose oscillator disagrees with its price
 * pane about which bar you are on is worse than no oscillator.
 *
 * Axes, labels, drawings and the crosshair are SVG: inspectable, themeable from
 * the same CSS variables as the rest of the app, and keyboard-navigable. The
 * dense series layers draw on a canvas beneath each pane; see `PaneCanvas`.
 */
export function ChartPro({
  bars: barsProp,
  symbol,
  locale,
  dict,
  tier,
  digits = 2,
  intraday = false,
  refLines = [],
  compare = [],
  foreign = null,
  breadth = null,
  events = [],
  initialView = DEFAULT_VIEW,
  tf = "1D",
}: {
  bars: Bar[];
  symbol: string;
  locale: Locale;
  dict: Dict;
  tier: Tier;
  digits?: number;
  /** Minute/hour bars need a clock on the axis; daily bars need a date. */
  intraday?: boolean;
  /** Horizontal reference levels — VN ceiling/floor (trần/sàn). Folded into the
   *  price scale so they are always visible. */
  refLines?: RefLine[];
  /** Series drawn as normalised shapes for relative strength. Isolated from the
   *  price scale — they never move the candles. */
  compare?: CompareSeries[];
  /** Foreign net buy/sell per bar (VND), drawn as signed bars in its own pane. */
  foreign?: CompareSeries | null;
  /** Percent of VN30 members above their own 20-day average, per bar. */
  breadth?: CompareSeries | null;
  /** Corporate actions to mark on the axis. Placed against the VISIBLE bars, so
   *  a marker only ever appears on the session it actually happened. */
  events?: CorpEvent[];
  /** The view a shared link carried, already decoded and clamped server-side. */
  initialView?: ChartView;
  /** Interval id, for the exported image's name and stamp. */
  tf?: string;
}) {
  // null = the reader has not chosen this session, so the stored setup wins.
  // Derived rather than copied into state by an effect: an effect would cascade
  // a second render, and reading storage during render would disagree with the
  // server markup. `useStored` yields null on the server, so the first client
  // render matches and this settles on the next frame — the same mechanism the
  // drawings below already rely on.
  const [typeChoice, setTypeChoice] = useState<ChartType | null>(null);
  const [scaleChoice, setScaleChoice] = useState<ScaleId | null>(null);
  const [ratioChoice, setRatioChoice] = useState<number | null>(null);
  const [range, setRange] = useState<number>(DEFAULT_RANGE);
  /**
   * Whether the reader chose "Tất cả". Held as intent rather than as a bar
   * count: a count goes stale the moment a bar is appended, and "everything
   * loaded" should keep meaning that. Any zoom returns to a counted window.
   */
  const [fitAll, setFitAll] = useState(initialView.range === "ALL");
  /** The window the chart actually shows; 0 is "every loaded bar". */
  const shownRange = fitAll ? 0 : range;
  // Applied once, from the link, before the reader touches anything.
  const seededRange = useRef(false);
  // How far back the window sits, in bars. See `lib/chart/pan`.
  const [offset, setOffset] = useState(0);
  const [activeChoice, setActiveChoice] = useState<string[] | null>(null);
  const [hover, setHoverLocal] = useState<number | null>(null);
  const sync = useChartSync();
  // Stable per mount and unique per cell: two cells showing the SAME symbol in
  // a grid must still be told apart, so the symbol is not enough.
  const cellId = useId();

  const setHover = setHoverLocal;
  // The pointer's own height, so the crosshair can answer "what price is my
  // cursor at" rather than only "what did this candle close at".
  const [cursorY, setCursorY] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);
  const [full, setFull] = useState(false);

  // Drawing state. Read through useSyncExternalStore so the first render agrees
  // with what is stored and other tabs stay in sync.
  const [mode, setMode] = useState<"cursor" | DrawingKind>("cursor");
  // A list, not a single point: the channel tool needs three anchors, and a
  // one-slot pending silently discarded the middle one.
  const [pending, setPending] = useState<{ t: number; p: number }[]>([]);
  const canDraw = can(tier, "chart:drawings");
  /** The ceiling the reader just hit, so it can be explained where they hit it. */
  const [gate, setGate] = useState<{ gate: Gate; limit?: number; asked?: boolean; n: number } | null>(null);
  /**
   * Raising a gate carries a sequence number so the hint REMOUNTS every time,
   * even when the same gate fires twice. Without it a hint that has been
   * dismissed once stays dismissed for the session, and the second refusal
   * renders nothing at all — the silent no-op the hint exists to replace.
   */
  const gateSeq = useRef(0);
  const raiseGate = useCallback((g: { gate: Gate; limit?: number; asked?: boolean }) => {
    gateSeq.current += 1;
    setGate({ ...g, n: gateSeq.current });
  }, []);

  const { drawings, selectedId, setSelectedId, histFlags, commitDrawings, addDrawing, deleteSelected, stepHistory } =
    useDrawingStore({ symbol, tier, raiseGate });

  /**
   * Live touch points, by pointer id.
   *
   * A chart that can only be zoomed by wheel and keyboard offers no zoom at all
   * on a phone, which is where most of this market reads. Two fingers pinch;
   * one still drags.
   */
  const touches = useRef(new Map<number, { x: number; y: number }>());
  /** The gesture's starting geometry, so the scale is measured from its start. */
  const gesture = useRef<
    { spread: number; range: number; offset: number; fraction: number; cx: number } | null
  >(null);

  /** An in-progress drawing edit: which drawing, which anchor, and from where. */
  const edit = useRef<
    { id: string; anchor: number; t: number; price: number; before: Drawing[]; moved: boolean } | null
  >(null);
  const drag = useRef<{ x: number; offset: number; moved: boolean } | null>(null);
  /**
   * The drawing being dragged, as it stands mid-gesture.
   *
   * Committed ONCE, on release. Writing it back on every pointer move was a
   * synchronous localStorage write per event — which fired the store event,
   * re-read and re-parsed every drawing and serialised the list several more
   * times — and then re-rendered the chart. The ref carries the latest copy
   * between frames; the state is what the pane draws, at most once a frame.
   */
  const [draft, setDraft] = useState<Drawing | null>(null);
  const draftRef = useRef<Drawing | null>(null);
  const draftFrame = useRef<number | null>(null);
  const shownDrawings = useMemo(() => withDraft(drawings, draft), [drawings, draft]);

  const wrapRef = useRef<HTMLDivElement>(null);
  const getPanes = useCallback(
    () => Array.from(wrapRef.current?.querySelectorAll<SVGSVGElement>('svg[role="img"]') ?? []),
    [],
  );
  const isBusy = useCallback(() => !!(drag.current || edit.current || gesture.current), []);
  const { bars, releaseHeld } = useSeriesBars({ barsProp, symbol, tf, fitAll, range, offset, isBusy });

  const [width, setWidth] = useState(900);
  const [priceH, setPriceH] = useState(340);
  /**
   * The price pane's share of the viewport as a WHOLE PERCENT, or `null` before
   * anything has been measured.
   *
   * `null` on the server AND on the hydration render, because there is no
   * window to divide by until the first effect runs. Substituting a nominal
   * viewport height there — which the divider's `aria-valuenow` used to do —
   * makes the server say 34 and the client say 43 about the same divider, and
   * React reports that as a hydration mismatch on every chart load.
   *
   * Stored pre-rounded because a whole percent is all `aria-valuenow` consumes:
   * where `paneHeight` clamps, the raw ratio changes on every pixel of a window
   * resize while the pane height does not, so keeping it raw would re-render
   * every pane ~60x a second for a value nothing can observe.
   */
  const [ratioPct, setRatioPct] = useState<number | null>(null);
  /**
   * The exact ratio behind that percent.
   *
   * Kept in a ref and advanced BEFORE the state update, the same way the
   * indicator toggle does it. Reading it from render state instead makes a HELD
   * arrow key — which repeats far faster than React re-renders — compute every
   * step from the same stale height, so ten presses move the divider once. It
   * is exact rather than rounded-lg so a nudge never quantises to the reported
   * whole percent.
   */
  const ratioRef = useRef<number | null>(null);
  const hintSeen = useStored(HINT_KEY);
  const firstChart = useStored(FIRST_CHART_KEY);

  useEffect(() => {
    if (!full) return;
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") setFull(false); };
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [full]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(320, e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const limit = INDICATOR_LIMIT[tier];
  const unlocked = can(tier, "chart:indicators");

  // Named ranges resolve to bar counts, which is what the pan/zoom machinery
  // already speaks — so this changes what the reader picks, not how it draws.
  const presets = useMemo(
    () => RANGE_PRESETS.map((id) => ({ id, count: barsForPreset(bars, id) })),
    [bars],
  );
  useEffect(() => {
    if (seededRange.current || !initialView.range || !bars.length) return;
    seededRange.current = true;
    setRange(barsForPreset(bars, initialView.range));
  }, [initialView.range, bars]);

  const effectiveRange = fitAll || range === 0 || range > bars.length ? bars.length : range;
  const activePreset = useMemo(
    () => presetForBars(bars, effectiveRange),
    [bars, effectiveRange],
  );
  /**
   * A preset from the toolbar. "Tất cả" is recorded as a choice, not as its
   * count, so it keeps covering everything as the series changes under it.
   */
  const pickPreset = useCallback((id: RangePreset, count: number) => {
    setFitAll(id === "ALL");
    setRange(count);
  }, []);



  // Alert levels come from the same external store AlertPanel writes, so the
  // line on the chart and the row in the rail can never disagree.
  const storedAlerts = useStored(ALERTS_KEY);
  const alertLines = useMemo(
    () => parseAlerts(storedAlerts).filter((a) => a.symbol === symbol.toUpperCase()),
    [storedAlerts, symbol],
  );

  const storedSettings = useStored(SETTINGS_KEY);
  const saved = useMemo(() => {
    const parsed = parseSettings(storedSettings);
    if (!parsed) return null;
    // Both questions — is this a real indicator, and may this reader have it —
    // go to `restorable`, which knows that a stored token is not an id. Asking
    // the second one out here, of the token, is what dropped every tuned
    // indicator from a free or signed-out reader's restored chart.
    const usable = restorable(
      parsed,
      limit,
      (id) => INDICATORS.some((d) => d.id === id),
      (id) => unlocked || !!INDICATORS.find((d) => d.id === id)?.free,
    );
    return {
      type: usable.type,
      indicators: usable.indicators,
      scale: usable.scale,
      paneRatio: usable.paneRatio,
    };
  }, [storedSettings, limit, unlocked]);

  // Precedence: what the reader just chose, then what the LINK said, then their
  // stored setup. A link beats a preference because they clicked that link — a
  // shared chart that silently reverts to the recipient's own setup is not the
  // chart that was shared.
  const type = typeChoice ?? initialView.type ?? saved?.type ?? DEFAULT_SETTINGS.type;
  // A link that names an axis wins over a stored preference, for the same
  // reason the chart type does: the reader clicked that link.
  const scale = scaleChoice
    ?? (initialView.scale !== DEFAULT_SCALE ? initialView.scale : null)
    ?? saved?.scale ?? DEFAULT_SETTINGS.scale;
  // Not carried in the URL: how tall a reader likes their pane is a preference
  // about their screen, not part of the chart a link describes.
  const paneRatio = ratioChoice ?? saved?.paneRatio ?? DEFAULT_SETTINGS.paneRatio;

  useEffect(() => {
    const measure = () => {
      const h = paneHeight(full, paneRatio);
      const r = paneRatio ?? h / window.innerHeight;
      setPriceH(h);
      // Seeded here rather than mirrored through an effect, so the ref is never
      // null for the commit between the measurement and that effect running —
      // an arrow key landing in that window nudged from a 0.5 fallback.
      ratioRef.current = r;
      setRatioPct(Math.round(r * 100));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [full, paneRatio]);
  const active =
    activeChoice
    ?? (initialView.ind.length ? initialView.ind : null)
    ?? (saved?.indicators.length ? saved.indicators : DEFAULT_SETTINGS.indicators);

  // Kept in the address bar with replaceState, not a router push: this is the
  // reader adjusting what they are looking at, not navigating, so it must not
  // add a history entry per indicator toggle — but the link they copy, and the
  // one they bookmark, has to be the chart actually on screen.
  const viewRef = useRef<string>("");
  useEffect(() => {
    const next = mergeViewIntoQuery(window.location.search, { type, ind: active, range: activePreset, scale });
    if (next === viewRef.current) return;
    viewRef.current = next;
    const url = `${window.location.pathname}${next ? `?${next}` : ""}`;
    window.history.replaceState(null, "", url);
  }, [type, active, activePreset, scale]);


  // Persist deliberately, from the two handlers that change the setup, rather
  // than from an effect watching state — an effect would also fire for the
  // restore itself and write back what it just read.
  const persistSettings = useCallback((next: {
    type?: ChartType; indicators?: string[]; scale?: ScaleId; paneRatio?: number | null;
  }) => {
    const current = parseSettings(storedSettings) ?? DEFAULT_SETTINGS;
    writeStored(SETTINGS_KEY, serializeSettings({
      type: next.type ?? current.type,
      indicators: next.indicators ?? current.indicators,
      scale: next.scale ?? current.scale,
      paneRatio: next.paneRatio !== undefined ? next.paneRatio : current.paneRatio,
    }));
  }, [storedSettings]);

  const chooseType = useCallback((t: ChartType) => {
    setTypeChoice(t);
    persistSettings({ type: t });
  }, [persistSettings]);

  /**
   * Drag the divider between the price pane and everything under it.
   *
   * The height is applied live so the chart follows the pointer, but only
   * WRITTEN on release: persisting per frame would put a storage write (and, on
   * a paid tier, a queued sync) behind every pixel of the drag.
   */
  const resize = useRef<{ startY: number; startH: number } | null>(null);
  const onDividerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    resize.current = { startY: e.clientY, startH: priceH };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }, [priceH]);
  const onDividerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const r = resize.current;
    if (!r || (e.buttons & 1) !== 1) return;
    const next = clampPaneRatio((r.startH + (e.clientY - r.startY)) / window.innerHeight);
    ratioRef.current = next;
    setRatioChoice(next);
  }, []);
  const onDividerUp = useCallback(() => {
    if (!resize.current) return;
    resize.current = null;
    setRatioChoice((r) => {
      if (r !== null) persistSettings({ paneRatio: r });
      return r;
    });
  }, [persistSettings]);

  /** Keyboard equivalent: a divider only a mouse can move is not operable. */
  const nudgeDivider = useCallback((dir: -1 | 1) => {
    const base = ratioRef.current ?? 0.5;
    const next = clampPaneRatio(base + (dir * 24) / window.innerHeight);
    ratioRef.current = next;
    setRatioChoice(next);
    persistSettings({ paneRatio: next });
  }, [persistSettings]);

  const chooseScale = useCallback((sc: ScaleId) => {
    setScaleChoice(sc);
    persistSettings({ scale: sc });
    track("chart_scale_changed", { scale: sc, tier });
  }, [persistSettings, tier]);

  const [wStart, wEnd] = useMemo(() => windowBounds(bars.length, shownRange, offset), [bars.length, shownRange, offset]);
  const view = useMemo(() => bars.slice(wStart, wEnd), [bars, wStart, wEnd]);
  // The compare series is aligned to the full bars, so slice it by the same
  // window as the visible candles.
  const breadthView = useMemo(
    () => (breadth ? breadth.series.slice(wStart, wEnd) : null),
    [breadth, wStart, wEnd],
  );

  const compareView = useMemo(
    () => compare.map((c) => ({ label: c.label, series: c.series.slice(wStart, wEnd) })),
    [compare, wStart, wEnd],
  );
  const foreignView = useMemo(
    () => (foreign ? foreign.series.slice(wStart, wEnd) : null),
    [foreign, wStart, wEnd],
  );
  const canPan = shownRange > 0 && shownRange < bars.length;
  /**
   * The window drawn: the visible one, plus `BLEED` of it on each side while a
   * drag is in progress.
   *
   * A drag moves what is drawn by a transform on every pointer move and
   * re-renders only to re-centre it; the margin is what it reveals in between,
   * so a drag shows bars rather than empty canvas. Only a drag draws it: every
   * other render would pay for 60% more canvas that nothing can reveal. Scales
   * and read-outs still come from the visible window alone.
   */
  const [panning, setPanning] = useState(false);
  const bleedBars = canPan && panning ? Math.ceil(view.length * BLEED) : 0;
  const dStart = Math.max(0, wStart - bleedBars);
  const dEnd = Math.min(bars.length, wEnd + bleedBars);
  const lead = wStart - dStart;
  const drawView = useMemo(() => bars.slice(dStart, dEnd), [bars, dStart, dEnd]);
  const compareDraw = useMemo(() => compare.map((c) => c.series.slice(dStart, dEnd)), [compare, dStart, dEnd]);
  const breadthDraw = useMemo(() => (breadth ? breadth.series.slice(dStart, dEnd) : null), [breadth, dStart, dEnd]);
  const foreignDraw = useMemo(() => (foreign ? foreign.series.slice(dStart, dEnd) : null), [foreign, dStart, dEnd]);
  /** Bar-length arrays reach the panes by context, not props; see `ChartSeries`. */
  const series = useMemo<ChartSeries>(() => ({
    view, drawView, compareDraw,
    breadth: breadthView ? { pct: breadthView, pctDraw: breadthDraw ?? breadthView } : null,
    foreign: foreignView ? { net: foreignView, netDraw: foreignDraw ?? foreignView } : null,
  }), [view, drawView, compareDraw, breadthView, breadthDraw, foreignView, foreignDraw]);
  /**
   * Event markers, placed once per series and then cut to the drawn window.
   * Placing derives a day key for every bar, so doing it per render put that
   * work on every re-centre of a pan and every wheel notch.
   */
  const placedAll = useMemo(() => placeEvents(bars, events), [bars, events]);
  const placed = useMemo(
    () => placedAll.filter((e) => e.i >= dStart && e.i < dEnd).map((e) => ({ ...e, i: e.i - dStart })),
    [placedAll, dStart, dEnd],
  );
  // A pointer can fire many moves per frame; the chart can only paint once.
  const panFrame = useRef<number | null>(null);
  const panTo = useRef<number | null>(null);

  // Indicators are computed over the VISIBLE window. Computing over all history
  // and slicing would be more "correct" for warm-up, but it makes the same
  // indicator render differently at different zooms, which reads as a bug.
  /**
   * Indicators are computed ONCE over the whole loaded series, then sliced to
   * the visible window.
   *
   * Computing them per window was both slow and wrong. Slow, because every pan
   * step and every wheel notch re-ran Wilder smoothing over the series. Wrong,
   * because a 50-bar average computed on a 60-bar view is undefined for its
   * first 49 bars — so zooming in blanked the start of every moving average and
   * shifted the values that survived. The same bar must read the same at every
   * zoom level.
   */
  const allPlots = useMemo(() => {
    const out: { def: IndicatorDef; plots: Plot[]; period: number | null }[] = [];
    for (const token of active) {
      const ref = parseRef(token);
      if (!ref) continue;
      const def = INDICATORS.find((i) => i.id === ref.id);
      // A period outside the registry's range is clamped, not refused: a
      // hand-typed URL should give the longest average the chart supports
      // rather than a broken pane.
      if (def) out.push({ def, plots: def.compute(bars, effectivePeriod(def, ref.period)), period: ref.period });
    }
    return out;
  }, [active, bars]);

  const computed = useMemo(() => {
    const cut = (p: Plot): Plot => ({ ...p, series: p.series.slice(wStart, wEnd) });
    const groups = allPlots.map((g) => ({ def: g.def, period: g.period, plots: g.plots.map(cut) }));
    return {
      groups,
      price: groups.filter((g) => g.def.pane === "price").flatMap((g) => g.plots),
      panes: groups.filter((g) => g.def.pane === "oscillator"),
    };
  }, [allPlots, wStart, wEnd]);
  // The same plots over the drawn window, in the same order as `computed`.
  const drawPlots = useMemo(() => {
    const cut = (p: Plot): Plot => ({ ...p, series: p.series.slice(dStart, dEnd) });
    return {
      price: allPlots.filter((g) => g.def.pane === "price").flatMap((g) => g.plots.map(cut)),
      panes: allPlots.filter((g) => g.def.pane === "oscillator").map((g) => g.plots.map(cut)),
    };
  }, [allPlots, dStart, dEnd]);

  // Mirrors `active` so the refused paths are observable — a gate we cannot
  // count is a gate we cannot price — without the stale-closure hazard that
  // reading the state variable directly would bring. Advancing the ref before
  // `setActive` keeps two clicks landing in one render batch composing, which is
  // the property the functional updater used to provide.
  const activeRef = useRef(active);
  // Synced after commit, never during render (a render-phase ref write is not a
  // legal read/write point and the linter rejects it). A click handler always
  // runs after the commit that produced the DOM it fired on, so the ref it reads
  // is the committed set.
  useEffect(() => { activeRef.current = active; }, [active]);

  const toggle = useCallback((def: IndicatorDef) => {
    if (!def.free && !unlocked) {
      track("chart_limit_hit", { gate: "indicator", reason: "locked", id: def.id, tier, limit });
      raiseGate({ gate: "indicator", limit });
      return;
    }
    const prev = activeRef.current;
    // By INDICATOR, not by token: clicking RSI while a 21-day RSI is on turns
    // that one off rather than adding a second RSI beside it.
    const on = prev.some((t) => sameIndicator(t, def.id));
    if (!on && prev.length >= limit) {
      track("chart_limit_hit", { gate: "indicator", reason: "limit", id: def.id, tier, limit });
      raiseGate({ gate: "indicator", limit });
      return; // at the tier's ceiling
    }
    const next = on ? prev.filter((t) => !sameIndicator(t, def.id)) : [...prev, def.id];
    activeRef.current = next;
    setActiveChoice(next);
    persistSettings({ indicators: next });
    track("chart_indicator_toggled", { id: def.id, on: !on, active_count: next.length, limit, tier });
  }, [limit, unlocked, tier, persistSettings, raiseGate]);

  /**
   * Retune an active indicator.
   *
   * Free for every tier: a chart whose periods are welded on is a chart you
   * look at rather than one you work in, and putting the knob behind a paywall
   * would teach readers it is not theirs. The gate is SAVING the tuned set,
   * which is a layout slot.
   */
  const setPeriod = useCallback((def: IndicatorDef, period: number) => {
    if (!def.param) return;
    const p = clampPeriod(def, period);
    const prev = activeRef.current;
    const next = prev.map((t) => (sameIndicator(t, def.id) ? formatRef({ id: def.id, period: p }, def) : t));
    activeRef.current = next;
    setActiveChoice(next);
    persistSettings({ indicators: next });
    track("chart_indicator_tuned", { id: def.id, period: p, tier });
  }, [persistSettings, tier]);

  const plotW = width - PAD.left - PAD.right;
  const band = plotW / Math.max(1, view.length);
  // `band` holds still during a pan (it is the plot width over the bar count),
  // so `x` keeps its identity for the whole gesture and only changes on a zoom
  // or a resize — which is what lets the panes memoize geometry built from it.
  const x = useCallback((i: number) => PAD.left + band * (i + 0.5), [band]);
  // How many columns this plot can actually resolve. Past it, neighbouring
  // bars share a pixel and the extra geometry is invisible work — the browser
  // still parses and rasterises every byte of it on each pan frame. Derived
  // once here; every pane used to derive it again from the same width.
  const maxCols = maxColumnsFor(plotW);
  const bleedPx = bleedBars * band;
  const drawCols = Math.max(1, Math.round((maxCols * drawView.length) / Math.max(1, view.length)));

  const [pan] = useState(createPanLayers);
  // The offset the drawn layers show, and the fractional one under a dragging
  // pointer (null when nothing is being dragged).
  const panShown = useRef(offset);
  const panLive = useRef<number | null>(null);
  // The re-centre in flight, so a move never starts a second one on top of it.
  const panPending = useRef<number | null>(null);
  const panRest = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (panRest.current) clearTimeout(panRest.current); }, []);
  // After every pane has redrawn for this commit (child layout effects run
  // first), so the shift is reset in the same paint as the new window.
  useLayoutEffect(() => {
    panShown.current = offset;
    panPending.current = null;
    pan.set(panLive.current === null ? 0 : (panLive.current - offset) * band);
  }, [offset, band, pan]);

  // Inverses of the price pane's scales, so a click becomes a (time, price)
  // pair rather than a pixel that would drift on the next zoom.
  /**
   * Wheel zoom.
   *
   * Bound natively rather than through `onWheel` because React registers wheel
   * as a passive listener, where `preventDefault` is ignored and the page
   * scrolls out from under the chart. Ctrl+wheel is left alone: that is how a
   * reader zooms the whole page, and taking it would remove an accessibility
   * affordance to add a convenience.
   */
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey || !e.deltaY) return;
      const plot = plotW > 0 ? plotW : 1;
      const rect = el.getBoundingClientRect();
      e.preventDefault();
      const fraction = (e.clientX - rect.left - PAD.left) / plot;
      const next = zoomAt({
        total: bars.length,
        range: shownRange, offset, fraction,
        direction: e.deltaY > 0 ? 1 : -1,
      });
      setFitAll(false);
      setRange(next.range);
      setOffset(next.offset);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [bars.length, shownRange, offset, plotW]);

  // Reference-line prices join the domain so a ceiling above every high is still
  // on screen. PricePane draws from this same object, so the crosshair inverse
  // here and the drawn scale cannot disagree. A stable string key drives the memo.
  const refKey = refLines.map((r) => r.price).join(",");
  const priceGeom = useMemo(() => {
    if (!view.length) return { yMin: 0, yMax: 1, H: priceH, sc: "lin" as ScaleId };
    const refPrices = refKey ? refKey.split(",").map(Number) : [];
    const { lo: min, hi: max } = priceExtent(view, computed.price.map((o) => o.series), refPrices);
    // The requested scale is only honoured if the data supports it; a series
    // touching zero has no logarithm, and falling back beats a broken axis.
    const sc = effectiveScale(scale, min, max, view[0].c);
    const { min: yMin, max: yMax } = padRange(sc, min, max);
    return { yMin, yMax, H: priceH, sc };
  }, [view, computed.price, priceH, refKey, scale]);

  const priceAtY = useCallback((py: number) => {
    const { yMin, yMax, H, sc } = priceGeom;
    const frac = 1 - (py - 10) / (H - 20);
    return denorm(sc, frac, yMin, yMax);
  }, [priceGeom]);

  const barAtX = useCallback((px: number) =>
    Math.max(0, Math.min(view.length - 1, Math.round((px - PAD.left) / band - 0.5))), [view.length, band]);

  /**
   * Tell the grid which MOMENT this cell's pointer is on.
   *
   * Done in an effect rather than inside the pointer handler so it cannot fire
   * during a state update, and keyed on the bar's timestamp so moving within
   * one bar publishes nothing — a pointer crossing a candle emits dozens of
   * events, and each would otherwise re-render every other cell.
   */
  const hoverT = hover !== null ? (view[hover]?.t ?? null) : null;
  const publish = sync.publish;
  const isSource = sync.sourceId === cellId;
  useEffect(() => {
    // Only the cell that owns the crosshair may clear it. Without this, a
    // companion — which has no hover of its own — publishes null on the very
    // render the source's hover caused, and erases it.
    if (hoverT === null && !isSource) return;
    publish(cellId, hoverT);
  }, [publish, cellId, hoverT, isSource]);

  const linked = useMemo(
    () => (hover !== null || sync.sourceId === cellId ? null : linkedIndex(view, sync.hoverT)),
    [hover, sync.hoverT, sync.sourceId, cellId, view],
  );
  if (!view.length) {
    return <p className="py-16 text-center text-[13px] text-muted">{dict.common.noData}</p>;
  }

  /**
   * The crosshair, which may belong to a sibling cell.
   *
   * This cell's own pointer wins when it has one. Otherwise the grid's hovered
   * MOMENT is resolved against this symbol's own bars, and resolves to nothing
   * when this symbol has no bar there — a companion that did not trade at that
   * moment shows no crosshair rather than one parked on the nearest day.
   */
  // Clamped, because the hover was picked against a window that a zoom may
  // since have re-sliced: four handlers change `range` and none of them own the
  // hover. Reading `view[idx - 1].c` for a bar that is no longer there is the
  // crash a reader sees on an ordinary zoom.
  const shownHover = clampHover(hover ?? linked, view.length);
  const idx = shownHover ?? view.length - 1;
  const activeBar = view[idx];
  const prevClose = idx > 0 ? view[idx - 1].c : activeBar.o;
  const activeChange = activeBar.c - prevClose;

  const onPriceClick = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!canDraw) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const price = priceAtY(py);
    const t = view[barAtX(px)].t;

    if (mode === "hline") {
      addDrawing({ id: newId(), kind: "hline", price });
      return;
    }
    // One click, like an hline, but it records WHEN as well as at what price —
    // settlement is counted from the trade date.
    if (mode === "trade") {
      addDrawing({ id: newId(), kind: "trade", t, price });
      return;
    }
    // A moment, with no price: an earnings date, a policy announcement.
    if (mode === "vline") {
      addDrawing({ id: newId(), kind: "vline", t });
      return;
    }
    if (mode === "text") {
      const note = (window.prompt(dict.chart.toolTextPrompt) ?? "").trim();
      // An empty note is a cancelled action, not a blank label on the chart.
      if (note) addDrawing({ id: newId(), kind: "text", t, price, text: note.slice(0, MAX_TEXT_LEN) });
      return;
    }
    if (mode !== "cursor") {
      // Each click adds an anchor until the tool has all it needs. Order is
      // meaningful: Fibonacci reads the pair as the swing being measured, and a
      // channel reads the first two as its baseline and the third as its width.
      const pts = [...pending, { t, p: price }];
      if (pts.length < TOOL_POINTS[mode]) return setPending(pts);
      const [a, b, c] = pts;
      if (mode === "channel") {
        addDrawing({ id: newId(), kind: "channel", t1: a.t, p1: a.p, t2: b.t, p2: b.p, t3: c.t, p3: c.p });
      } else {
        // Spelled out per kind rather than spread with a computed `kind`: the
        // union stays discriminated, so a tool added without a branch here is a
        // compile error rather than a silent gap.
        const seg = { id: newId(), t1: a.t, p1: a.p, t2: b.t, p2: b.p };
        addDrawing(
          mode === "trend" ? { ...seg, kind: "trend" }
          : mode === "fib" ? { ...seg, kind: "fib" }
          : mode === "fibext" ? { ...seg, kind: "fibext" }
          : mode === "ray" ? { ...seg, kind: "ray" }
          : mode === "rect" ? { ...seg, kind: "rect" }
          : { ...seg, kind: "measure" },
        );
      }
      setPending([]);
      return;
    }
    // Cursor mode doubles as erase: clicking a drawing removes it. Tolerances
    // are computed in normalised space so time and price compare fairly.
    // Cursor mode SELECTS. It used to erase on contact, which made every
    // inspection of a drawing destructive and gave a reader no way to nudge one
    // — they had to delete and redraw. Deleting is now an explicit act on
    // something already selected, and undo makes it recoverable either way.
    const hit = hitTest(drawings, t, price, normOf(), HIT_TOLERANCE);
    setSelectedId(hit ? hit.id : null);
  };

  /**
   * Normalised coordinates for hit-testing.
   *
   * Time and price differ by orders of magnitude, so both are mapped to 0..1
   * over the visible window before any distance is measured — otherwise the
   * time axis would dominate every comparison and nothing would ever be
   * grabbed by price.
   */
  function normOf() {
    const tSpan = (view[view.length - 1].t - view[0].t) || 1;
    const pSpan = (priceGeom.yMax - priceGeom.yMin) || 1;
    return {
      t: (v: number) => (v - view[0].t) / tSpan,
      p: (v: number) => (v - priceGeom.yMin) / pSpan,
    };
  }

  // A press is ambiguous until it moves: held still it is a click (draw or
  // erase), dragged it is a pan. Deciding on pointerUP means a drawing is never
  // dropped by a hand that shifted a few pixels.
  const onDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.pointerType === "touch") {
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.current.size === 2) {
        // A second finger converts the gesture: abandon whatever the first was
        // doing, so a pinch never leaves a half-drawn line or a stray pan.
        const [a, b] = [...touches.current.values()];
        const rect = e.currentTarget.getBoundingClientRect();
        const cx = (a.x + b.x) / 2;
        gesture.current = {
          spread: spreadOf(a, b),
          range: effectiveRange,
          offset,
          // Anchored at the midpoint, so the bars between the fingers are the
          // ones that stay put — the same contract the wheel has.
          fraction: Math.min(1, Math.max(0, (cx - rect.left - PAD.left) / (plotW || 1))),
          cx,
        };
        drag.current = null;
        edit.current = null;
        setPending([]);
        return;
      }
    }
    // In cursor mode a press on a drawing starts an edit, not a pan. Decided
    // here rather than on move, because by the time the pointer has travelled
    // far enough to look like a drag the chart would already have panned.
    if (mode === "cursor" && view.length) {
      const rect = e.currentTarget.getBoundingClientRect();
      const t = view[barAtX(e.clientX - rect.left)].t;
      const price = priceAtY(e.clientY - rect.top);
      const nrm = normOf();
      const chosen = selectedId ? drawings.find((d) => d.id === selectedId) ?? null : null;
      // An anchor of the ALREADY selected drawing wins over anything else: the
      // handle a reader is aiming at may sit on top of another drawing.
      const anchor = chosen ? hitAnchor(chosen, t, price, nrm, ANCHOR_TOLERANCE) : -1;
      if (chosen && anchor >= 0) {
        edit.current = { id: chosen.id, anchor, t, price, before: drawings, moved: false };
        e.currentTarget.setPointerCapture?.(e.pointerId);
        return;
      }
      const hit = hitTest(drawings, t, price, nrm, HIT_TOLERANCE);
      if (hit) {
        setSelectedId(hit.id);
        edit.current = { id: hit.id, anchor: -1, t, price, before: drawings, moved: false };
        e.currentTarget.setPointerCapture?.(e.pointerId);
        return;
      }
    }
    drag.current = { x: e.clientX, offset, moved: false };
    if (canPan) {
      e.currentTarget.setPointerCapture?.(e.pointerId);
      // Draw the margin a pan reveals now, while the pointer is still down.
      setPanning(true);
    }
  };

  const onUp = (e: React.PointerEvent<SVGSVGElement>) => {
    // The gesture is over, so a bar that arrived during it can land now.
    releaseHeld();
    if (panning) setPanning(false);
    if (e.pointerType === "touch") {
      touches.current.delete(e.pointerId);
      // Lifting one finger of a pinch ends the gesture rather than silently
      // handing the remaining finger a pan from wherever it happens to be.
      if (touches.current.size < 2 && gesture.current) {
        gesture.current = null;
        touches.current.clear();
        drag.current = null;
        return;
      }
    }
    const ed = edit.current;
    edit.current = null;
    if (ed) {
      // The drag's last frame may still be queued; the release is final.
      if (draftFrame.current !== null) {
        cancelAnimationFrame(draftFrame.current);
        draftFrame.current = null;
      }
      const final = draftRef.current;
      draftRef.current = null;
      setDraft(null);
      // A press that never moved is a selection, already applied on down. Only
      // an actual edit becomes an undo step, so tapping a drawing to look at it
      // does not fill the stack. A CANCELLED gesture — the browser taking the
      // pointer back — leaves the drawing where it was, not where it was
      // abandoned.
      if (ed.moved && final && e.type !== "pointercancel") {
        track("chart_drawing_edited", { kind: final.kind, anchor: ed.anchor, symbol });
        commitDrawings(withDraft(drawings, final));
      }
      return;
    }
    const d = drag.current;
    drag.current = null;
    // The drag is over, so any frame still queued for it is stale.
    if (panFrame.current !== null) {
      cancelAnimationFrame(panFrame.current);
      panFrame.current = null;
    }
    if (panLive.current !== null) {
      panLive.current = null;
      // Synchronous, not a transition: the window let go on is the one on
      // screen from the next frame, and it supersedes any render in flight.
      if (panTo.current !== null) setOffset(panTo.current);
      // Landing on the window already drawn commits nothing, so nothing else
      // would clear the shift.
      if (panTo.current === null || panTo.current === panShown.current) pan.set(0);
    }
    panTo.current = null;
    panPending.current = null;
    if (panRest.current !== null) { clearTimeout(panRest.current); panRest.current = null; }
    if (d && !d.moved) onPriceClick(e);
  };

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.pointerType === "touch" && touches.current.has(e.pointerId)) {
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const g = gesture.current;
      if (g && touches.current.size === 2) {
        const [a, b] = [...touches.current.values()];
        const next = pinch({
          total: bars.length, startRange: g.range, startOffset: g.offset,
          startSpread: g.spread, spread: spreadOf(a, b), fraction: g.fraction,
        });
        // Two fingers also PAN: the midpoint moving is a drag, so a reader can
        // zoom and reposition in one gesture instead of two.
        const mid = (a.x + b.x) / 2;
        setFitAll(false);
        setRange(next.range);
        setOffset(offsetFromDrag(next.offset, mid - g.cx, plotW / Math.max(1, next.range), bars.length, next.range));
        return;
      }
    }
    const ed = edit.current;
    if (ed && (e.buttons & 1) === 1 && view.length) {
      const rect = e.currentTarget.getBoundingClientRect();
      const t = view[barAtX(e.clientX - rect.left)].t;
      const price = priceAtY(e.clientY - rect.top);
      // The drawing as it stands mid-gesture: the in-flight copy once there is one.
      const cur = draftRef.current ?? drawings.find((d) => d.id === ed.id);
      if (!cur) return;
      const moved = ed.anchor >= 0
        ? moveAnchor(cur, ed.anchor, t, price)
        : translate(cur, t - ed.t, price - ed.price);
      // Neither stored nor recorded here: one drag is one undo step and one
      // write, both on release. Only the edited drawing is compared.
      if (!sameDrawing(moved, cur)) {
        ed.moved = true;
        // Translation is relative, so the origin has to travel with the pointer
        // or the drawing accelerates away from it.
        if (ed.anchor < 0) { ed.t = t; ed.price = price; }
        draftRef.current = moved;
        // A pointer can fire many moves per frame; the pane paints once.
        if (draftFrame.current === null) {
          draftFrame.current = requestAnimationFrame(() => {
            draftFrame.current = null;
            setDraft(draftRef.current);
          });
        }
      }
      return;
    }
    const d = drag.current;
    if (d && canPan && (e.buttons & 1) === 1) {
      const dx = e.clientX - d.x;
      if (Math.abs(dx) > 3) d.moved = true;
      if (d.moved) {
        panTo.current = offsetFromDrag(d.offset, dx, band, bars.length, range);
        // Every move: shift what is drawn, unrounded, with no render at all.
        panLive.current = Math.min(Math.max(0, d.offset + dx / Math.max(band, 0.5)), maxOffset(bars.length, range));
        pan.set((panLive.current - panShown.current) * band);
        // A render only re-centres what is drawn: once the shift has used half
        // the margin, or when the pointer rests. Every move between is the
        // transform alone. One re-centre at a time, as a transition, so it is
        // never restarted and never blocks a move.
        const recenter = () => {
          const to = panTo.current;
          if (to === null || panPending.current !== null || to === panShown.current) return;
          panPending.current = to;
          startTransition(() => setOffset(to));
        };
        if (Math.abs(panLive.current - panShown.current) * band > bleedPx / 2) recenter();
        if (panRest.current !== null) clearTimeout(panRest.current);
        panRest.current = setTimeout(() => { panRest.current = null; recenter(); }, PAN_REST_MS);
        setHover((h) => (h === null ? h : null));
        setCursorY((v) => (v === null ? v : null));
        return;
      }
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const i = Math.round((e.clientX - rect.left - PAD.left) / band - 0.5);
    const next = Math.max(0, Math.min(view.length - 1, i));
    // Moving a pixel inside the same candle changed nothing but still re-rendered
    // every pane. Returning the identical value makes React skip the update.
    setHover((h) => (h === next ? h : next));
    // Rounded: a sub-pixel change moves nothing a reader can see but would
    // re-render every pane.
    const py = Math.round(e.clientY - rect.top);
    setCursorY((v) => (v === py ? v : py));
  };
  const onKey = (e: React.KeyboardEvent<SVGSVGElement>) => {
    // Undo/redo on the platform's own chord, so it works without being taught.
    const chord = e.metaKey || e.ctrlKey;
    if (chord && (e.key === "z" || e.key === "Z")) {
      e.preventDefault();
      stepHistory(e.shiftKey ? "redo" : "undo");
      return;
    }
    if (chord && (e.key === "y" || e.key === "Y")) {
      e.preventDefault();
      stepHistory("redo");
      return;
    }
    if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
      e.preventDefault();
      deleteSelected();
      return;
    }
    // Escape clears a selection and abandons a half-drawn tool — the one key a
    // reader tries when a chart feels stuck.
    if (e.key === "Escape") {
      if (selectedId) setSelectedId(null);
      if (pending.length) setPending([]);
      return;
    }
    // Shift+Arrow pans. A chart that can only be moved by dragging is a chart a
    // keyboard user cannot scroll back through.
    if (e.shiftKey && (e.key === "ArrowRight" || e.key === "ArrowLeft")) {
      e.preventDefault();
      const stepBars = Math.max(1, Math.round(range / 4));
      setOffset((o) => Math.min(Math.max(0, o + (e.key === "ArrowLeft" ? stepBars : -stepBars)), maxOffset(bars.length, range)));
      return;
    }
    if (e.key === "+" || e.key === "=" || e.key === "-") {
      e.preventDefault();
      const next = zoomAt({
        total: bars.length, range: shownRange, offset, fraction: 0.5,
        direction: e.key === "-" ? 1 : -1,
      });
      setFitAll(false);
      setRange(next.range);
      setOffset(next.offset);
      return;
    }
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      setHover((h) => {
        const base = h ?? view.length - 1;
        return Math.max(0, Math.min(view.length - 1, base + (e.key === "ArrowRight" ? 1 : -1)));
      });
    } else if (e.key === "Escape") { setHover(null); setCursorY(null); }
  };

  const xStep = Math.max(1, Math.floor(view.length / 6));
  const drawn = { lead, bleedPx, drawCols, plotW };

  return (
    <div className={full ? "fixed inset-0 z-50 overflow-auto bg-page p-4" : ""}>
      <Toolbar
        dict={dict} locale={locale} unlocked={unlocked} limit={limit}
        type={type} setType={chooseType} scale={scale} setScale={chooseScale} pickPreset={pickPreset}
        presets={presets} activePreset={activePreset} barCount={effectiveRange}
        getPanes={getPanes} symbol={symbol} tf={tf}
        exportSite={can(tier, "sync:docs") ? null : undefined}
        active={active} toggle={toggle} asTable={asTable} setAsTable={setAsTable}
        full={full} toggleFull={() => setFull((v) => !v)} canDraw={canDraw}
      />

      {hintSeen === null && (
        <p role="note" className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted">
          {dict.chart.firstHint}
          <button type="button" onClick={() => writeStored(HINT_KEY, "1")}
            className="rounded-lg border border-line px-2 py-0.5 text-[11px] font-medium text-ink-2 hover:text-ink">
            {dict.chart.gotIt}
          </button>
        </p>
      )}

      {/* Shown once, to a reader who has just arrived from onboarding: the
          first thing worth doing on a chart is marking a level, and nobody
          discovers a drawing rail by being left alone with it. */}
      {firstChart === "1" && canDraw && (
        <p role="status" className="mt-2 flex items-center justify-between gap-3 rounded-lg border border-line bg-page px-3 py-2 text-[12px] text-ink-2">
          {dict.chart.firstChartHint}
          <button type="button" onClick={() => writeStored(FIRST_CHART_KEY, null)}
            className="shrink-0 rounded-lg border border-line px-2 py-0.5 text-[11px] font-medium hover:text-ink">
            {dict.chart.gotIt}
          </button>
        </p>
      )}

      {/* The live region is always in the tree, so a hint that appears later is
          a CONTENT change inside it rather than a region arriving already
          populated — which NVDA and JAWS routinely fail to announce. */}
      <div role="status" aria-live="polite">
        {gate && (
          <GateHint key={gate.n} gate={gate.gate} limit={gate.limit} asked={gate.asked}
            locale={locale} dict={dict} tier={tier} onClose={() => setGate(null)} />
        )}
      </div>

      <StatusLine
        symbol={symbol} activeBar={activeBar} activeChange={activeChange} groups={computed.groups} idx={idx}
        locale={locale} digits={digits} intraday={intraday} dict={dict} setPeriod={setPeriod} toggle={toggle}
      />

      {/* Once the window has been panned back, the way home must be one click —
          dragging all the way to the present is not a reasonable ask. */}
      {!asTable && offset > 0 && (
        <button type="button" onClick={() => setOffset(0)}
          className="mt-2 rounded-lg border border-line bg-page px-2.5 py-1 text-[12px] font-medium text-ink-2 hover:text-ink">
          {dict.chart.panBack} →
        </button>
      )}

      {asTable ? (
        <BarTable bars={view} locale={locale} dict={dict} digits={digits} intraday={intraday} />
      ) : (
        <div className="mt-2 flex flex-col gap-2 lg:flex-row">
          <DrawingRail
            dict={dict} canDraw={canDraw} tier={tier} symbol={symbol} raiseGate={raiseGate}
            mode={mode} setMode={setMode} setPending={setPending}
            histFlags={histFlags} stepHistory={stepHistory}
            selectedId={selectedId} deleteSelected={deleteSelected}
            hasDrawings={drawings.length > 0}
            clearDrawings={() => { commitDrawings([]); setPending([]); setSelectedId(null); }}
          />
          {/* No text selection: a drag on the plot is a pan, and selecting the
              axis labels under it both looks broken and repaints every move. */}
          <div ref={wrapRef} className="min-w-0 flex-1 select-none">
          <PanLayersContext.Provider value={pan}>
          <ChartSeriesContext.Provider value={series}>
          <PricePane
            intraday={intraday}
            {...drawn} width={width} band={band} x={x} PAD={PAD} maxCols={maxCols}
            drawOverlays={drawPlots.price}
            type={type} overlays={computed.price} hover={shownHover} idx={idx} H={priceH}
            refLines={refLines} alerts={alertLines} compareView={compareView} placedEvents={placed} geom={priceGeom} selectedId={selectedId}
            locale={locale} digits={digits} symbol={symbol} dict={dict}
            drawings={shownDrawings} pending={pending} mode={mode} onClick={onDown}
            onMove={onMove} onLeave={() => { setHover(null); setCursorY(null); }} onKey={onKey} onUp={onUp} canPan={canPan}
            cursorY={cursorY}
          />
          {/* The divider between the price pane and everything below it.
              `separator` with a value is what a screen reader needs to say what
              dragging it does, and the arrow keys make it operable without a
              pointer — a divider only a mouse can move is not a control. */}
          <div
            role="separator"
            aria-orientation="horizontal"
            aria-label={dict.chart.resizePane}
            aria-valuenow={ratioPct ?? undefined}
            aria-valuemin={Math.round(MIN_PANE_RATIO * 100)}
            aria-valuemax={Math.round(MAX_PANE_RATIO * 100)}
            tabIndex={ratioPct === null ? -1 : 0}
            onPointerDown={onDividerDown}
            onPointerMove={onDividerMove}
            onPointerUp={onDividerUp}
            onPointerCancel={onDividerUp}
            onKeyDown={(e) => {
              if (e.key === "ArrowUp") { e.preventDefault(); nudgeDivider(-1); }
              if (e.key === "ArrowDown") { e.preventDefault(); nudgeDivider(1); }
            }}
            className="group relative h-2 cursor-row-resize touch-none"
          >
            <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-line group-hover:bg-accent group-focus:bg-accent" />
          </div>
          <VolumePane {...drawn} width={width} band={band} x={x} PAD={PAD} maxCols={maxCols} hover={shownHover} intraday={intraday} locale={locale} />
          {breadthView && (
            <BreadthPane
              {...drawn} intraday={intraday} width={width} band={band} x={x} PAD={PAD} maxCols={maxCols} hover={shownHover}
              label={breadth?.label ?? ""} locale={locale}
            />
          )}
          {foreignView && (
            <ForeignPane
              {...drawn} width={width} band={band} x={x} PAD={PAD} maxCols={maxCols} hover={shownHover} intraday={intraday}
              label={foreign?.label ?? "Khối ngoại"} locale={locale}
            />
          )}
          {computed.panes.map(({ def, period, plots }, i) => (
            <OscillatorPane
              intraday={intraday} {...drawn}
              key={def.id} def={def} period={period} plots={plots} drawPlots={drawPlots.panes[i] ?? plots} width={width}
              band={band} x={x} PAD={PAD} maxCols={maxCols} hover={shownHover} idx={idx} locale={locale}
            />
          ))}
          <XAxis {...drawn} PAD={PAD} fromEnd={bars.length - 1 - dStart} width={width} x={x} xStep={xStep} locale={locale} hover={shownHover} intraday={intraday} />
          </ChartSeriesContext.Provider>
          </PanLayersContext.Provider>
          </div>
        </div>
      )}
    </div>
  );
}
