"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { barTime, dateOnly, num, volume as fmtVol } from "@/lib/format";
import { PATHS, type Dict } from "@/lib/i18n";
import { COLOR_VAR, INDICATORS, type IndicatorDef, type Plot } from "@/lib/ta/registry";
import { IndicatorMenu } from "./IndicatorMenu";
import { ShareMenu } from "./ShareMenu";
import { useDismiss } from "@/lib/ui/use-dismiss";
import { DRAWING_LIMIT, INDICATOR_LIMIT, can } from "@/lib/auth/entitlement";
import {
  channelParallel, distanceToChannel, distanceToFib, distanceToHLine, distanceToTrend,
  fibLevels, newId, parseDrawings, serializeDrawings, storageKey, trendPriceAt,
  type Drawing, type DrawingKind,
} from "@/lib/chart/drawings";
import { maxOffset, nearestIndex, offsetFromDrag, windowBounds, zoomAt } from "@/lib/chart/pan";
import { isSettled, settlementDate, unrealisedPct } from "@/lib/chart/settlement";
import { candlePaths, volumePaths } from "@/lib/chart/paths";
import { RANGE_PRESETS, barsForPreset, presetForBars, type RangePreset } from "@/lib/chart/ranges";
import { DEFAULT_VIEW, mergeViewIntoQuery, type ChartView } from "@/lib/chart/view-state";
import { dashFor } from "@/lib/chart/compare";
import { useStored, writeStored } from "@/lib/browser-store";
import { useSyncedDoc } from "@/lib/use-synced-doc";
import { mergeById } from "@/lib/docs-sync";
import {
  DEFAULT_SETTINGS, SETTINGS_KEY, parseSettings, restorable, serializeSettings,
} from "@/lib/chart/settings";
import { track } from "@/lib/analytics/posthog";
import { parseAlerts, STORAGE_KEY as ALERTS_KEY, type PriceAlert } from "@/lib/alerts/alerts";
import type { Bar, Locale, Tier } from "@/lib/types";

type ChartType = "candle" | "line" | "area";

/** Legend keys that mirror the dash patterns, so the mapping survives greyscale. */
function dashGlyph(i: number): string {
  return ["┄", "┈", "┅"][i % 3];
}

/** Rail icons. The accessible name comes from `aria-label`, not from these. */
const TOOL_GLYPH: Record<"cursor" | DrawingKind, string> = {
  // The channel has no single character that reads as two parallel lines and
  // still fits the button, so it draws its own icon below.
  cursor: "⌖", hline: "─", trend: "╱", fib: "≣", fibext: "⇗", channel: "", trade: "▮",
};

/** How many clicks each tool needs before it becomes a drawing. */
const TOOL_POINTS: Record<DrawingKind, number> = {
  hline: 1, trend: 2, fib: 2, fibext: 2, channel: 3, trade: 1,
};
const DEFAULT_RANGE = 120; // bars; 0 = everything loaded
/** Shown once, then dismissed for good. */
const HINT_KEY = "hint:chart";

/**
 * Price-pane height. The chart is the page: on a phone it takes 60% of the
 * viewport (the rail is a bottom sheet there, so nothing competes for the
 * height), on a desktop it grows with the window instead of a fixed 340px.
 */
function paneHeight(full: boolean): number {
  if (typeof window === "undefined") return 340;
  if (full) return Math.max(280, window.innerHeight - 230);
  if (window.innerWidth < 1024) return Math.max(280, Math.round(window.innerHeight * 0.6));
  return Math.max(280, Math.min(520, Math.round(window.innerHeight * 0.48)));
}

/**
 * Multi-pane chart workspace.
 *
 * Panes share one x-scale and one hovered index, so the crosshair and every
 * read-out move together — a chart whose oscillator disagrees with its price
 * pane about which bar you are on is worse than no oscillator.
 *
 * Drawn as SVG rather than canvas: it stays inspectable, themeable from the same
 * CSS variables as the rest of the app, and keyboard-navigable without a
 * parallel accessibility implementation.
 */
export function ChartPro({
  bars,
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
  const [range, setRange] = useState<number>(DEFAULT_RANGE);
  // Applied once, from the link, before the reader touches anything.
  const seededRange = useRef(false);
  // How far back the window sits, in bars. See `lib/chart/pan`.
  const [offset, setOffset] = useState(0);
  const [activeChoice, setActiveChoice] = useState<string[] | null>(null);
  const [hover, setHover] = useState<number | null>(null);
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
  const stored = useStored(storageKey(symbol));
  const drawings = useMemo(() => parseDrawings(stored), [stored]);
  const writeDrawings = useCallback(
    (next: Drawing[]) => writeStored(storageKey(symbol), next.length ? serializeDrawings(next) : null),
    [symbol],
  );

  // Drawings follow the account only on a tier that bought portability; on free
  // they stay in this browser, which is exactly what the pricing page promises.
  const canSync = can(tier, "sync:docs");
  const drawLimit = DRAWING_LIMIT[tier];
  const mergeDrawings = useCallback(
    (mine: Drawing[], theirs: Drawing[]) => mergeById(mine, theirs).slice(0, drawLimit),
    [drawLimit],
  );
  const { markDirty } = useSyncedDoc<Drawing[]>({
    kind: "drawings",
    docKey: symbol,
    local: drawings,
    applyRemote: writeDrawings,
    merge: mergeDrawings,
    canSync,
  });

  // Every mutation goes through here so a local edit is both stored and queued.
  const saveDrawings = useCallback(
    (next: Drawing[]) => {
      writeDrawings(next);
      markDirty();
    },
    [writeDrawings, markDirty],
  );

  // The free ceiling is enforced here because free drawings never reach the
  // server; the paid ceiling is re-checked there. Both read DRAWING_LIMIT, so
  // the two cannot drift.
  const addDrawing = useCallback(
    (d: Drawing) => {
      if (drawings.length >= drawLimit) {
        track("chart_limit_hit", { gate: "drawing", tier, limit: drawLimit, symbol });
        return false;
      }
      saveDrawings([...drawings, d]);
      track("chart_drawing_created", { kind: d.kind, count: drawings.length + 1, symbol });
      return true;
    },
    [drawings, drawLimit, saveDrawings, tier, symbol],
  );

  const wrapRef = useRef<HTMLDivElement>(null);
  const getPanes = useCallback(
    () => Array.from(wrapRef.current?.querySelectorAll<SVGSVGElement>('svg[role="img"]') ?? []),
    [],
  );
  const [width, setWidth] = useState(900);
  const [priceH, setPriceH] = useState(340);
  const hintSeen = useStored(HINT_KEY);

  useEffect(() => {
    const measure = () => setPriceH(paneHeight(full));
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [full]);

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

  const effectiveRange = range === 0 || range > bars.length ? bars.length : range;
  const activePreset = useMemo(
    () => presetForBars(bars, effectiveRange),
    [bars, effectiveRange],
  );



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
    const usable = restorable(parsed, limit, (id) => INDICATORS.some((d) => d.id === id));
    return {
      type: usable.type,
      // An indicator saved on Plus must not come back after the subscription
      // lapsed — the stored setup is a preference, never an entitlement.
      indicators: usable.indicators.filter(
        (id) => unlocked || INDICATORS.find((d) => d.id === id)?.free,
      ),
    };
  }, [storedSettings, limit, unlocked]);

  // Precedence: what the reader just chose, then what the LINK said, then their
  // stored setup. A link beats a preference because they clicked that link — a
  // shared chart that silently reverts to the recipient's own setup is not the
  // chart that was shared.
  const type = typeChoice ?? initialView.type ?? saved?.type ?? DEFAULT_SETTINGS.type;
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
    const next = mergeViewIntoQuery(window.location.search, { type, ind: active, range: activePreset });
    if (next === viewRef.current) return;
    viewRef.current = next;
    const url = `${window.location.pathname}${next ? `?${next}` : ""}`;
    window.history.replaceState(null, "", url);
  }, [type, active, activePreset]);


  // Persist deliberately, from the two handlers that change the setup, rather
  // than from an effect watching state — an effect would also fire for the
  // restore itself and write back what it just read.
  const persistSettings = useCallback((next: { type?: ChartType; indicators?: string[] }) => {
    const current = parseSettings(storedSettings) ?? DEFAULT_SETTINGS;
    writeStored(SETTINGS_KEY, serializeSettings({
      type: next.type ?? current.type,
      indicators: next.indicators ?? current.indicators,
    }));
  }, [storedSettings]);

  const chooseType = useCallback((t: ChartType) => {
    setTypeChoice(t);
    persistSettings({ type: t });
  }, [persistSettings]);
  const [wStart, wEnd] = useMemo(() => windowBounds(bars.length, range, offset), [bars.length, range, offset]);
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
  const canPan = range > 0 && range < bars.length;
  const drag = useRef<{ x: number; offset: number; moved: boolean } | null>(null);
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
    const out: { def: IndicatorDef; plots: Plot[] }[] = [];
    for (const id of active) {
      const def = INDICATORS.find((i) => i.id === id);
      if (def) out.push({ def, plots: def.compute(bars) });
    }
    return out;
  }, [active, bars]);

  const computed = useMemo(() => {
    const cut = (p: Plot): Plot => ({ ...p, series: p.series.slice(wStart, wEnd) });
    const groups = allPlots.map((g) => ({ def: g.def, plots: g.plots.map(cut) }));
    return {
      groups,
      price: groups.filter((g) => g.def.pane === "price").flatMap((g) => g.plots),
      panes: groups.filter((g) => g.def.pane === "oscillator"),
    };
  }, [allPlots, wStart, wEnd]);

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
      return;
    }
    const prev = activeRef.current;
    const on = prev.includes(def.id);
    if (!on && prev.length >= limit) {
      track("chart_limit_hit", { gate: "indicator", reason: "limit", id: def.id, tier, limit });
      return; // at the tier's ceiling
    }
    const next = on ? prev.filter((x) => x !== def.id) : [...prev, def.id];
    activeRef.current = next;
    setActiveChoice(next);
    persistSettings({ indicators: next });
    track("chart_indicator_toggled", { id: def.id, on: !on, active_count: next.length, limit, tier });
  }, [limit, unlocked, tier, persistSettings]);

  const PAD = { left: 6, right: 58 };
  const plotW = width - PAD.left - PAD.right;
  const band = plotW / Math.max(1, view.length);
  const x = (i: number) => PAD.left + band * (i + 0.5);

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
        range, offset, fraction,
        direction: e.deltaY > 0 ? 1 : -1,
      });
      setRange(next.range);
      setOffset(next.offset);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [bars.length, range, offset, plotW, PAD.left]);

  // Reference-line prices join the domain so a ceiling above every high is still
  // on screen; PricePane repeats this exact fold, so the crosshair inverse here
  // and the drawn scale stay identical. A stable string key drives the memo.
  const refKey = refLines.map((r) => r.price).join(",");
  const priceGeom = useMemo(() => {
    if (!view.length) return { yMin: 0, yMax: 1, H: priceH };
    const refPrices = refKey ? refKey.split(",").map(Number) : [];
    const overlayVals = computed.price.flatMap((o) => o.series.filter((v): v is number => v !== null));
    const min = Math.min(...view.map((b) => b.l), ...overlayVals, ...refPrices);
    const max = Math.max(...view.map((b) => b.h), ...overlayVals, ...refPrices);
    const pad = (max - min) * 0.06 || max * 0.02 || 1;
    return { yMin: min - pad, yMax: max + pad, H: priceH };
  }, [view, computed.price, priceH, refKey]);

  const priceAtY = useCallback((py: number) => {
    const { yMin, yMax, H } = priceGeom;
    const frac = 1 - (py - 10) / (H - 20);
    return yMin + frac * (yMax - yMin);
  }, [priceGeom]);

  const barAtX = useCallback((px: number) =>
    Math.max(0, Math.min(view.length - 1, Math.round((px - PAD.left) / band - 0.5))), [view.length, band, PAD.left]);

  if (!view.length) {
    return <p className="py-16 text-center text-[13px] text-muted">{dict.common.noData}</p>;
  }

  const idx = hover ?? view.length - 1;
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
    if (mode !== "cursor") {
      // Each click adds an anchor until the tool has all it needs. Order is
      // meaningful: Fibonacci reads the pair as the swing being measured, and a
      // channel reads the first two as its baseline and the third as its width.
      const pts = [...pending, { t, p: price }];
      if (pts.length < TOOL_POINTS[mode]) return setPending(pts);
      const [a, b, c] = pts;
      addDrawing(mode === "channel"
        ? { id: newId(), kind: "channel", t1: a.t, p1: a.p, t2: b.t, p2: b.p, t3: c.t, p3: c.p }
        : { id: newId(), kind: mode, t1: a.t, p1: a.p, t2: b.t, p2: b.p });
      setPending([]);
      return;
    }
    // Cursor mode doubles as erase: clicking a drawing removes it. Tolerances
    // are computed in normalised space so time and price compare fairly.
    const tSpan = (view[view.length - 1].t - view[0].t) || 1;
    const pSpan = (priceGeom.yMax - priceGeom.yMin) || 1;
    const nrm = { t: (v: number) => (v - view[0].t) / tSpan, p: (v: number) => (v - priceGeom.yMin) / pSpan };
    const hit = drawings.find((d) => {
      if (d.kind === "hline") return distanceToHLine(d, price) / pSpan < 0.012;
      if (d.kind === "trend") return distanceToTrend(d, t, price, nrm) < 0.012;
      if (d.kind === "channel") return distanceToChannel(d, t, price, nrm) < 0.012;
      // A trade marker is grabbed by its entry level, like an hline.
      if (d.kind === "trade") return Math.abs(d.price - price) / pSpan < 0.012;
      return distanceToFib(d, t, price) / pSpan < 0.012;
    });
    if (hit) {
      saveDrawings(drawings.filter((d) => d.id !== hit.id));
      track("chart_drawing_deleted", { kind: hit.kind, symbol });
    }
  };

  // A press is ambiguous until it moves: held still it is a click (draw or
  // erase), dragged it is a pan. Deciding on pointerUP means a drawing is never
  // dropped by a hand that shifted a few pixels.
  const onDown = (e: React.PointerEvent<SVGSVGElement>) => {
    drag.current = { x: e.clientX, offset, moved: false };
    if (canPan) e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const onUp = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    drag.current = null;
    // The drag is over, so any frame still queued for it is stale.
    if (panFrame.current !== null) {
      cancelAnimationFrame(panFrame.current);
      panFrame.current = null;
      if (panTo.current !== null) setOffset(panTo.current);
      panTo.current = null;
    }
    if (d && !d.moved) onPriceClick(e);
  };

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (d && canPan && (e.buttons & 1) === 1) {
      const dx = e.clientX - d.x;
      if (Math.abs(dx) > 3) d.moved = true;
      if (d.moved) {
        panTo.current = offsetFromDrag(d.offset, dx, band, bars.length, range);
        if (panFrame.current === null) {
          panFrame.current = requestAnimationFrame(() => {
            panFrame.current = null;
            if (panTo.current !== null) setOffset(panTo.current);
          });
        }
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
        total: bars.length, range, offset, fraction: 0.5,
        direction: e.key === "-" ? 1 : -1,
      });
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

  return (
    <div className={full ? "fixed inset-0 z-50 overflow-auto bg-page p-4" : ""}>
      <Toolbar
        dict={dict} locale={locale} unlocked={unlocked} limit={limit}
        type={type} setType={chooseType} setRange={setRange}
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
            className="rounded border border-line px-2 py-0.5 text-[11px] font-medium text-ink-2 hover:text-ink">
            {dict.chart.gotIt}
          </button>
        </p>
      )}

      {/* Status line: symbol + OHLC + indicator values, the way a terminal
          reports the bar under the cursor. */}
      <dl className="tnum mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded border border-line bg-surface-2 px-2.5 py-1.5 text-[12px]">
        <div className="flex gap-1.5"><dt className="sr-only">{dict.chart.symbol}</dt><dd className="font-bold tracking-tight">{symbol}</dd></div>
        <div className="flex gap-1.5"><dt className="sr-only">{dict.common.updated}</dt><dd title={dict.common.updated}>{stamp(activeBar.t, locale, intraday)}</dd></div>
        <div className="flex gap-1.5"><dt className="text-muted">O</dt><dd>{num(activeBar.o, locale, digits)}</dd></div>
        <div className="flex gap-1.5"><dt className="text-muted">H</dt><dd>{num(activeBar.h, locale, digits)}</dd></div>
        <div className="flex gap-1.5"><dt className="text-muted">L</dt><dd>{num(activeBar.l, locale, digits)}</dd></div>
        <div className="flex gap-1.5">
          <dt className="text-muted">C</dt>
          <dd className={activeChange >= 0 ? "text-up" : "text-down"}>
            <span aria-hidden="true">{activeChange >= 0 ? "▲" : "▼"}</span> {num(activeBar.c, locale, digits)}
          </dd>
        </div>
        {activeBar.v > 0 && (
          <div className="flex gap-1.5"><dt className="text-muted">V</dt><dd>{fmtVol(activeBar.v, locale)}</dd></div>
        )}
        {/* One chip per indicator, with its value under the cursor and the
            way to remove it — the legend and the off switch are one thing. */}
        {computed.groups.map(({ def, plots }) => {
          const mine = def.pane === "price" ? plots : [];
          const color = COLOR_VAR[plots[0]?.color ?? "muted"];
          return (
            <div key={def.id} className="flex items-center gap-1.5 rounded border border-line bg-surface pl-1.5">
              <dt style={{ color }}>{def.short}</dt>
              <dd>
                {mine.length
                  ? mine.map((p) => (p.series[idx] === null ? "—" : num(p.series[idx]!, locale, digits))).join(" / ")
                  : null}
              </dd>
              <button type="button" onClick={() => toggle(def)} aria-label={`${dict.chart.remove} ${def.label}`}
                className="px-1.5 py-0.5 text-[11px] leading-none text-muted hover:text-down">
                <span aria-hidden="true">×</span>
              </button>
            </div>
          );
        })}
      </dl>

      {/* Once the window has been panned back, the way home must be one click —
          dragging all the way to the present is not a reasonable ask. */}
      {!asTable && offset > 0 && (
        <button type="button" onClick={() => setOffset(0)}
          className="mt-2 rounded border border-line bg-surface-2 px-2.5 py-1 text-[12px] font-medium text-ink-2 hover:text-ink">
          {dict.chart.panBack} →
        </button>
      )}

      {asTable ? (
        <BarTable bars={view} locale={locale} dict={dict} digits={digits} intraday={intraday} />
      ) : (
        <div className="mt-2 flex gap-2">
          {/* Vertical tool rail — the trading-terminal convention: tools live
              beside the canvas, not competing for the top bar. */}
          <div role="group" aria-label={dict.chart.draw}
            className="flex shrink-0 flex-col gap-1 rounded border border-line p-1">
            {(["cursor", "hline", "trend", "fib", "fibext", "channel", "trade"] as const).map((m) => {
              const locked = !canDraw && m !== "cursor";
              const label = dict.chart[m];
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => { setMode(m); setPending([]); }}
                  disabled={locked}
                  aria-pressed={mode === m}
                  aria-label={locked ? `${label} — ${dict.chart.drawLocked}` : label}
                  title={locked ? dict.chart.drawLocked : label}
                  className={`grid h-8 w-8 place-items-center rounded text-[13px] leading-none ${
                    mode === m ? "bg-surface-2 text-ink"
                      : locked ? "text-muted opacity-50"
                      : "text-ink-2 hover:bg-surface-2 hover:text-ink"
                  }`}
                >
                  <span aria-hidden="true">
                    {locked ? "🔒" : m === "channel" ? (
                      <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth={1.3}>
                        <line x1="1.5" y1="10" x2="8.5" y2="2" />
                        <line x1="6.5" y1="13" x2="13.5" y2="5" />
                      </svg>
                    ) : TOOL_GLYPH[m]}
                  </span>
                </button>
              );
            })}
            {drawings.length > 0 && (
              <button type="button" onClick={() => { saveDrawings([]); setPending([]); }}
                aria-label={dict.chart.clearDrawings} title={dict.chart.clearDrawings}
                className="grid h-8 w-8 place-items-center rounded text-[13px] text-ink-2 hover:bg-surface-2 hover:text-down">
                <span aria-hidden="true">🗑</span>
              </button>
            )}
          </div>

          <div ref={wrapRef} className="min-w-0 flex-1">
          <PricePane
            intraday={intraday}
            view={view} width={width} plotW={plotW} band={band} x={x} PAD={PAD}
            type={type} overlays={computed.price} hover={hover} idx={idx} H={priceH}
            refLines={refLines} alerts={alertLines} compareView={compareView}
            locale={locale} digits={digits} symbol={symbol} dict={dict}
            drawings={drawings} pending={pending} mode={mode} onClick={onDown}
            onMove={onMove} onLeave={() => { setHover(null); setCursorY(null); }} onKey={onKey} onUp={onUp} canPan={canPan}
            cursorY={cursorY}
          />
          <VolumePane view={view} width={width} band={band} x={x} PAD={PAD} hover={hover} intraday={intraday} locale={locale} />
          {breadthView && (
            <BreadthPane
              view={view} intraday={intraday} width={width} band={band} x={x} PAD={PAD} hover={hover}
              pct={breadthView} label={breadth?.label ?? ""} locale={locale}
            />
          )}
          {foreignView && (
            <ForeignPane
              view={view} width={width} band={band} x={x} PAD={PAD} hover={hover} intraday={intraday}
              net={foreignView} label={foreign?.label ?? "Khối ngoại"} locale={locale}
            />
          )}
          {computed.panes.map(({ def, plots }) => (
            <OscillatorPane
              intraday={intraday}
              key={def.id} def={def} plots={plots} width={width}
              band={band} x={x} PAD={PAD} hover={hover} idx={idx} locale={locale}
            />
          ))}
          <XAxis view={view} width={width} x={x} xStep={xStep} locale={locale} hover={hover} intraday={intraday} />
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── toolbar ─────────────────────────────────────────────────────────────── */

function Toolbar({
  dict, locale, unlocked, limit, type, setType, setRange, active, toggle, asTable, setAsTable,
  full, toggleFull, canDraw, presets, activePreset, barCount, getPanes, symbol, tf, exportSite,
}: {
  dict: Dict; locale: Locale; unlocked: boolean; limit: number;
  type: ChartType; setType: (t: ChartType) => void;
  setRange: (r: number) => void;
  presets: { id: RangePreset; count: number }[];
  activePreset: RangePreset | null;
  barCount: number;
  getPanes: () => SVGSVGElement[];
  symbol: string;
  tf: string;
  /** `null` means a clean image; `undefined` means stamp with this origin. */
  exportSite?: string | null;
  active: string[]; toggle: (d: IndicatorDef) => void;
  asTable: boolean; setAsTable: (v: boolean) => void;
  full: boolean; toggleFull: () => void; canDraw: boolean;
}) {
  const seg = "px-2.5 py-1 text-[12px] font-medium transition-colors";
  const btn = "shrink-0 rounded border border-line px-2.5 py-1 text-[12px] font-medium text-ink-2 hover:text-ink";
  const pricingHref = `/${locale}/${PATHS.pricing[locale]}?plan=plus`;

  return (
    // One row that scrolls on a phone; wraps only once there is room to.
    <div className="relative -mx-4 flex items-center gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:overflow-visible md:px-0 md:pb-0">
      <div role="group" aria-label={dict.chart.type} className="flex shrink-0 rounded border border-line">
        {(["candle", "line", "area"] as ChartType[]).map((t) => (
          <button key={t} type="button" onClick={() => { setType(t); track("chart_type_changed", { type: t }); }} aria-pressed={type === t}
            className={`${seg} first:rounded-l last:rounded-r ${type === t ? "bg-surface-2 text-ink" : "text-ink-2 hover:text-ink"}`}>
            {dict.chart[t]}
          </button>
        ))}
      </div>

      <IndicatorMenu dict={dict} unlocked={unlocked} limit={limit} active={active} toggle={toggle} pricingHref={pricingHref} />

      {/* Zoom is the wheel and +/−; the one button left is the way back out. */}
      <div role="group" aria-label={dict.chart.range} className="flex shrink-0 rounded border border-line">
        {presets.map((p) => (
          <button key={p.id} type="button" onClick={() => setRange(p.count)}
            aria-pressed={activePreset === p.id}
            className={`${seg} first:rounded-l last:rounded-r ${
              activePreset === p.id ? "bg-surface-2 text-ink" : "text-ink-2 hover:text-ink"
            }`}>
            {p.id === "ALL" ? dict.chart.all : p.id}
          </button>
        ))}
      </div>

      {/* The zoom level, in the unit the chart is actually drawn in. Without it
          a wheel-scroll changes the picture with nothing to say by how much. */}
      <span className="tnum shrink-0 text-[11px] text-muted">{barCount} {dict.chart.bars}</span>

      <button type="button" onClick={() => setAsTable(!asTable)} aria-pressed={asTable} className={btn}>
        {asTable ? dict.common.chartView : dict.common.tableView}
      </button>

      <span className="ml-auto flex shrink-0 items-center gap-2">
        <ShareMenu
          dict={dict} getPanes={getPanes} symbol={symbol} tf={tf}
          site={exportSite === null ? null : (typeof window === "undefined" ? null : window.location.origin)}
        />
        <HelpSheet dict={dict} canDraw={canDraw} />
        <button type="button" onClick={toggleFull} aria-pressed={full}
          title={full ? dict.chart.exitFullscreen : dict.chart.fullscreen}
          className="rounded border border-line px-2 py-1 text-[12px] font-medium text-ink-2 hover:text-ink">
          <span aria-hidden="true">{full ? "⤢" : "⛶"}</span>
          <span className="sr-only">{full ? dict.chart.exitFullscreen : dict.chart.fullscreen}</span>
        </button>
      </span>
    </div>
  );
}

/** The `?` button: every shortcut in one sheet, instead of hint lines under the chart. */
function HelpSheet({ dict, canDraw }: { dict: Dict; canDraw: boolean }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(wrap, open, close);
  const rows = (["pan", "zoom", "tf", "ind", "sym", ...(canDraw ? ["draw" as const] : []), "esc"] as const)
    .map((k) => dict.chart.keys[k]);
  return (
    <div ref={wrap} className="relative">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="dialog"
        aria-label={dict.chart.help} title={dict.chart.help}
        className="rounded border border-line px-2.5 py-1 text-[12px] font-semibold text-ink-2 hover:text-ink">
        ?
      </button>
      {open && (
        <div role="dialog" aria-label={dict.chart.help}
          className="absolute right-0 top-full z-30 mt-1 w-72 rounded border border-line bg-surface p-3 text-[12px] shadow-lg">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted">{dict.chart.help}</p>
          <ul className="space-y-1.5 text-ink-2">
            {rows.map((r) => <li key={r}>{r}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

/* ─── panes ───────────────────────────────────────────────────────────────── */

/**
 * The read-out stamp. Intraday bars need the clock as well as the day; daily
 * bars need only the date. The axis builds its own labels — see `XAxis`.
 */
function stamp(t: number, locale: Locale, intraday: boolean): string {
  return intraday ? `${dateOnly(t, locale).slice(0, 5)} ${barTime(t, locale)}` : dateOnly(t, locale);
}

interface PaneGeom {
  view: Bar[]; width: number; band: number; x: (i: number) => number;
  PAD: { left: number; right: number }; hover: number | null;
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

function niceTicks(min: number, max: number, count = 4): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) return [min];
  return Array.from({ length: count + 1 }, (_, i) => min + ((max - min) * i) / count);
}

function PricePane({
  view, width, plotW, band, x, PAD, type, overlays, hover, idx, locale, digits, symbol, dict, intraday,
  drawings, pending, mode, onClick, onMove, onLeave, onKey, onUp, canPan, H,
  refLines, alerts, compareView, cursorY,
}: PaneGeom & {
  H: number; plotW: number; type: ChartType; overlays: Plot[]; idx: number; locale: Locale; digits: number;
  symbol: string; dict: Dict;
  refLines: RefLine[]; alerts: PriceAlert[];
  compareView: { label: string; series: (number | null)[] }[];
  cursorY: number | null;
  drawings: Drawing[]; pending: { t: number; p: number }[]; mode: "cursor" | DrawingKind;
  onClick: (e: React.PointerEvent<SVGSVGElement>) => void;
  onMove: (e: React.PointerEvent<SVGSVGElement>) => void; onLeave: () => void;
  onUp: (e: React.PointerEvent<SVGSVGElement>) => void; canPan: boolean;
  onKey: (e: React.KeyboardEvent<SVGSVGElement>) => void;
}) {
  const overlayVals = overlays.flatMap((o) => o.series.filter((v): v is number => v !== null));
  const refPrices = refLines.map((r) => r.price);
  const min = Math.min(...view.map((b) => b.l), ...overlayVals, ...refPrices);
  const max = Math.max(...view.map((b) => b.h), ...overlayVals, ...refPrices);
  const pad = (max - min) * 0.06 || max * 0.02 || 1;
  const yMin = min - pad;
  const yMax = max + pad;
  const y = (v: number) => 10 + (H - 20) - ((v - yMin) / (yMax - yMin)) * (H - 20);

  // Compare line: its OWN min/max mapped to the pane's pixel band, so it shows
  // relative SHAPE without touching the price scale, candles or crosshair.
  // Each overlay is normalised against ITS OWN range and mapped to the pane's
  // pixel band, so relative SHAPE is comparable even when an index at 1,300 and
  // a share at 27 sit on the chart together — and none of them touch the price
  // scale, the candles or the crosshair.
  const comparePaths = compareView.map((c) => {
    const vals = c.series.filter((v): v is number => v !== null);
    const lo = vals.length ? Math.min(...vals) : 0;
    const hi = vals.length ? Math.max(...vals) : 1;
    const cy = (v: number) => 10 + (H - 20) - ((v - lo) / ((hi - lo) || 1)) * (H - 20);
    const d = c.series
      .map((v, i) => (v === null ? null : `${x(i).toFixed(1)},${cy(v).toFixed(1)}`))
      .filter(Boolean)
      .map((pt, i) => `${i === 0 ? "M" : "L"}${pt}`)
      .join(" ");
    return { label: c.label, d };
  }).filter((c) => c.d);

  const linePath = view.map((b, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(b.c).toFixed(1)}`).join(" ");

  return (
    <div className="relative">
      <svg
        width="100%" height={H} viewBox={`0 0 ${width} ${H}`} role="img" tabIndex={0}
        aria-label={`${symbol} ${dict.stocks.chartTitle}. ${dict.common.tableView}.`}
        onPointerMove={onMove} onPointerLeave={onLeave} onKeyDown={onKey}
        onPointerDown={onClick} onPointerUp={onUp} onPointerCancel={onUp}
        className={mode !== "cursor" ? "cursor-crosshair touch-pan-y" : canPan ? "cursor-grab touch-pan-y active:cursor-grabbing" : "touch-pan-y"}
      >
        {niceTicks(yMin, yMax).map((v) => (
          <g key={v}>
            <line x1={PAD.left} x2={PAD.left + plotW} y1={y(v)} y2={y(v)} stroke="var(--grid)" strokeWidth={1} />
            <text x={PAD.left + plotW + 6} y={y(v) + 3.5} fontSize={10} fill="var(--muted)" className="tnum">
              {num(v, locale, digits)}
            </text>
          </g>
        ))}

        {type === "area" && (
          <path
            d={`${linePath} L${x(view.length - 1)},${H - 10} L${x(0)},${H - 10} Z`}
            fill="var(--accent)" opacity={0.10}
          />
        )}
        {(type === "line" || type === "area") && (
          <path d={linePath} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" />
        )}
        {/* Four paths rather than three nodes per candle. hollow = up,
            filled = down: direction without relying on hue. */}
        {type === "candle" && (() => {
          const p = candlePaths(view, { x, y, bodyWidth: Math.max(1, Math.min(band * 0.62, 14)) });
          return (
            <g>
              <path d={p.upWick} stroke="var(--up)" strokeWidth={1} fill="none" />
              <path d={p.downWick} stroke="var(--down)" strokeWidth={1} fill="none" />
              <path d={p.upBody} fill="var(--surface)" stroke="var(--up)" strokeWidth={1} />
              <path d={p.downBody} fill="var(--down)" stroke="var(--down)" strokeWidth={1} />
            </g>
          );
        })()}

        {overlays.map((o) => {
          const d = o.series
            .map((v, i) => (v === null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`))
            .filter(Boolean)
            .map((pt, i) => `${i === 0 ? "M" : "L"}${pt}`)
            .join(" ");
          return (
            <path key={o.key} d={d} fill="none" stroke={COLOR_VAR[o.color]}
              strokeWidth={o.style === "band" ? 1 : 1.5} strokeDasharray={o.style === "band" ? "3 3" : undefined}
              opacity={o.style === "band" ? 0.8 : 1} />
          );
        })}

        {/* VN ceiling/floor reference levels (trần/sàn), on the price scale. */}
        {refLines.map((r) => (
          <g key={r.label}>
            <line
              x1={PAD.left} x2={PAD.left + plotW} y1={y(r.price)} y2={y(r.price)}
              className={r.dir === "up" ? "text-up" : "text-down"}
              stroke="currentColor" strokeWidth={1} strokeDasharray="2 4" opacity={0.7}
            />
            <text
              x={PAD.left + 4} y={y(r.price) - 3} fontSize={10}
              className={`tnum ${r.dir === "up" ? "text-up" : "text-down"}`} fill="currentColor"
            >
              {r.label} {num(r.price, locale, digits)}
            </text>
          </g>
        ))}

        {/* Armed price alerts, so the chart shows what it is watching for.
            Deliberately NOT folded into the price domain the way ceiling/floor
            are: an alert set far from the current price would squash every
            candle into a band to keep a line visible that the reader already
            knows about. One outside the visible range is simply not drawn. */}
        {alerts.map((a) => {
          if (a.price < yMin || a.price > yMax) return null;
          const rising = a.condition === "above" || a.condition === "cross_up";
          return (
            <g key={a.id} opacity={a.triggeredAt ? 0.45 : 0.9}>
              <line
                x1={PAD.left} x2={PAD.left + plotW} y1={y(a.price)} y2={y(a.price)}
                stroke="var(--accent)" strokeWidth={1} strokeDasharray="1 5"
              />
              {/* The glyph carries the direction, so the level is not colour-alone. */}
              <text
                x={PAD.left + plotW - 4} y={y(a.price) - 3} fontSize={10} textAnchor="end"
                className="tnum" fill="var(--accent)"
              >
                {rising ? "▲" : "▼"} {num(a.price, locale, digits)}
              </text>
            </g>
          );
        })}

        {/* Overlays: normalised shape only, never the price scale. Each gets its
            own dash pattern so they are told apart without relying on colour,
            and the legend repeats that pattern rather than a colour swatch. */}
        {comparePaths.map((c, i) => (
          <path key={c.label} d={c.d} fill="none" stroke="var(--muted)" strokeWidth={1.5}
            strokeDasharray={dashFor(i)} opacity={0.85} />
        ))}
        {comparePaths.length > 0 && (
          <text x={PAD.left + 4} y={H - 8} fontSize={10} fill="var(--muted)">
            {comparePaths.map((c, i) => `${i === 0 ? "" : "   "}${dashGlyph(i)} ${c.label}`).join("")}
          </text>
        )}

        {/* Trade markers: an entry level, a marker at the session the shares
            become sellable (VN settles T+2, credited after lunch — "T+2.5"),
            and the unrealised move. No global tool models this, and it is the
            first thing a VN holder wants from a chart of something they own. */}
        {drawings.map((d) => {
          if (d.kind !== "trade") return null;
          const yEntry = y(d.price);
          if (!Number.isFinite(yEntry)) return null;
          const last = view[view.length - 1]?.c ?? d.price;
          const move = unrealisedPct(d.price, last);
          const settleAt = settlementDate(d.t);
          const settled = isSettled(d.t, view[view.length - 1]?.t ?? d.t);
          const iEntry = nearestIndex(view, d.t);
          const iSettle = nearestIndex(view, settleAt);
          return (
            <g key={d.id}>
              <line x1={PAD.left} x2={PAD.left + plotW} y1={yEntry} y2={yEntry}
                stroke="var(--ink-2)" strokeWidth={1} strokeDasharray="6 2" opacity={0.8} />
              {/* Where the position was opened. */}
              <path d={`M${x(iEntry)},${yEntry - 5} L${x(iEntry) + 5},${yEntry} L${x(iEntry)},${yEntry + 5} L${x(iEntry) - 5},${yEntry} Z`}
                fill="var(--ink-2)" />
              {/* Until this line the shares cannot be sold at all. Solid once
                  they have settled, dashed while they are still locked. */}
              {iSettle > iEntry && (
                <line x1={x(iSettle)} x2={x(iSettle)} y1={8} y2={H - 8}
                  stroke="var(--ink-2)" strokeWidth={1}
                  strokeDasharray={settled ? undefined : "2 4"} opacity={0.55} />
              )}
              {/* Signed and glyphed, so the move never rides on colour alone. */}
              <text x={PAD.left + 4} y={yEntry - 4} fontSize={10} className="tnum"
                fill="var(--ink-2)">
                {move >= 0 ? "▲" : "▼"} {move >= 0 ? "+" : ""}{num(move, locale, 2)}% · {num(d.price, locale, digits)}
              </text>
            </g>
          );
        })}

        {/* Drawings map from data space through the same scales as the bars,
            so they stay pinned when the range changes. */}
        {drawings.map((d) => {
          if (d.kind === "hline") {
            return (
              <g key={d.id}>
                <line x1={PAD.left} x2={PAD.left + plotW} y1={y(d.price)} y2={y(d.price)}
                  stroke="var(--accent)" strokeWidth={1} strokeDasharray="4 3" />
                <text x={PAD.left + plotW + 6} y={y(d.price) + 3.5} fontSize={10} fill="var(--accent)" className="tnum">
                  {num(d.price, locale, digits)}
                </text>
              </g>
            );
          }
          // Binary search, not a scan: this runs for every endpoint of every
          // drawing on every frame of a pan.
          const iOf = (t: number) => nearestIndex(view, t);
          if (d.kind === "trade") return null; // drawn separately, below
          const i1 = iOf(d.t1), i2 = iOf(d.t2);

          if (d.kind === "channel") {
            const par = channelParallel(d);
            const ya = y(trendPriceAt(d, view[i1].t)), yb = y(trendPriceAt(d, view[i2].t));
            const pa = y(trendPriceAt(par, view[i1].t)), pb = y(trendPriceAt(par, view[i2].t));
            const i3 = iOf(d.t3);
            return (
              <g key={d.id}>
                {/* The band is what a channel is FOR — the two lines alone leave
                    the reader to infer which side of each one matters. */}
                <polygon points={`${x(i1)},${ya} ${x(i2)},${yb} ${x(i2)},${pb} ${x(i1)},${pa}`}
                  fill="var(--accent)" fillOpacity={0.08} />
                <line x1={x(i1)} y1={ya} x2={x(i2)} y2={yb} stroke="var(--accent)" strokeWidth={1.5} />
                <line x1={x(i1)} y1={pa} x2={x(i2)} y2={pb} stroke="var(--accent)" strokeWidth={1.5} />
                <circle cx={x(i1)} cy={ya} r={3} fill="var(--accent)" />
                <circle cx={x(i2)} cy={yb} r={3} fill="var(--accent)" />
                <circle cx={x(i3)} cy={y(d.p3)} r={3} fill="var(--accent)" />
              </g>
            );
          }

          if (d.kind === "fib" || d.kind === "fibext") {
            const from = Math.min(x(i1), x(i2));
            return (
              <g key={d.id}>
                {/* The swing being measured, drawn faintly: without it the
                    levels are just lines with no visible origin. */}
                <line x1={x(i1)} y1={y(d.p1)} x2={x(i2)} y2={y(d.p2)}
                  stroke="var(--muted)" strokeWidth={1} strokeDasharray="2 2" />
                {fibLevels(d).map((l) => {
                  // 50% and 61.8% are the levels traders actually watch; the
                  // rest are context and recede so the pair stays findable.
                  const key = l.ratio === 0.5 || l.ratio === 0.618;
                  const text = `${(l.ratio * 100).toFixed(1).replace(/[.]0$/, "")}% · ${num(l.price, locale, digits)}`;
                  // The line starts AFTER the label. Running it underneath reads
                  // as a strikethrough through the number it is labelling.
                  const w = text.length * 5.1;
                  const gap = from + w + 8;
                  return (
                    <g key={l.ratio}>
                      <line x1={Math.min(gap, PAD.left + plotW)} x2={PAD.left + plotW} y1={y(l.price)} y2={y(l.price)}
                        stroke="var(--accent)" strokeWidth={key ? 1.4 : 1} strokeOpacity={key ? 0.9 : 0.45} />
                      {/* A moving average or a candle wick crossing the label
                          reads as a strikethrough through the price. */}
                      <rect x={from} y={y(l.price) - 6} width={w + 4} height={12} rx={2}
                        fill="var(--page)" fillOpacity={0.85} />
                      <text x={from + 2} y={y(l.price) + 3} fontSize={9}
                        fill="var(--accent)" fillOpacity={key ? 1 : 0.75} className="tnum">
                        {text}
                      </text>
                    </g>
                  );
                })}
                <circle cx={x(i1)} cy={y(d.p1)} r={3} fill="var(--accent)" />
                <circle cx={x(i2)} cy={y(d.p2)} r={3} fill="var(--accent)" />
              </g>
            );
          }

          if (d.kind !== "trend") return null;
          return (
            <g key={d.id}>
              <line x1={x(i1)} y1={y(trendPriceAt(d, view[i1].t))} x2={x(i2)} y2={y(trendPriceAt(d, view[i2].t))}
                stroke="var(--accent)" strokeWidth={1.5} />
              <circle cx={x(i1)} cy={y(trendPriceAt(d, view[i1].t))} r={3} fill="var(--accent)" />
              <circle cx={x(i2)} cy={y(trendPriceAt(d, view[i2].t))} r={3} fill="var(--accent)" />
            </g>
          );
        })}
        {pending.map((pt, i) => (
          <circle key={`${pt.t}-${i}`} cx={x(nearestIndex(view, pt.t))} cy={y(pt.p)} r={4}
            fill="none" stroke="var(--accent)" strokeWidth={1.5} strokeDasharray="2 2" />
        ))}

        {/* Last-price tag: the standard terminal affordance for "where is it
            right now" without hunting along the axis. */}
        {(() => {
          const lastBar = view[view.length - 1];
          const up = lastBar.c >= (view[view.length - 2]?.c ?? lastBar.o);
          const ly = y(lastBar.c);
          return (
            <g>
              <line x1={PAD.left} x2={PAD.left + plotW} y1={ly} y2={ly}
                stroke={up ? "var(--up)" : "var(--down)"} strokeWidth={1} strokeDasharray="2 3" opacity={0.6} />
              <rect x={PAD.left + plotW + 2} y={ly - 8} width={PAD.right - 4} height={16} rx={2}
                fill={up ? "var(--up)" : "var(--down)"} />
              <text x={PAD.left + plotW + PAD.right / 2} y={ly + 4} fontSize={10} textAnchor="middle"
                fill="#fff" className="tnum">{num(lastBar.c, locale, digits)}</text>
            </g>
          );
        })()}

        {/* The horizontal half of the crosshair, at the POINTER rather than at the
            candle: reading a level off a chart means "what price is here", and
            answering only with the close makes the reader estimate the rest. */}
        {cursorY !== null && cursorY > 8 && cursorY < H - 8 && (() => {
          const atCursor = yMin + (1 - (cursorY - 10) / (H - 20)) * (yMax - yMin);
          const lastC = view[view.length - 1]?.c;
          const delta = lastC ? ((atCursor - lastC) / lastC) * 100 : 0;
          return (
            <g>
              <line x1={PAD.left} x2={PAD.left + plotW} y1={cursorY} y2={cursorY}
                stroke="var(--axis)" strokeWidth={1} strokeDasharray="3 3" />
              <rect x={PAD.left + plotW + 2} y={cursorY - 8} width={PAD.right - 4} height={16} rx={2}
                fill="var(--ink-2)" />
              <text x={PAD.left + plotW + PAD.right / 2} y={cursorY + 4} fontSize={10} textAnchor="middle"
                fill="var(--page)" className="tnum">{num(atCursor, locale, digits)}</text>
              {/* Signed, so the distance from the last close reads without colour. */}
              <text x={PAD.left + plotW - 4} y={cursorY - 5} fontSize={10} textAnchor="end"
                fill="var(--muted)" className="tnum">
                {delta >= 0 ? "+" : ""}{num(delta, locale, 2)}%
              </text>
            </g>
          );
        })()}

        {hover !== null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={0} y2={H} stroke="var(--axis)" strokeWidth={1} />
            {/* Price of the hovered bar, pinned to the axis. */}
            <rect x={PAD.left + plotW + 2} y={y(view[hover].c) - 8} width={PAD.right - 4} height={16} rx={2}
              fill="var(--ink)" />
            <text x={PAD.left + plotW + PAD.right / 2} y={y(view[hover].c) + 4} fontSize={10} textAnchor="middle"
              fill="var(--page)" className="tnum">{num(view[hover].c, locale, digits)}</text>
          </g>
        )}
      </svg>

      {/* A three-click tool that says nothing after two clicks reads as broken. */}
      {pending.length > 0 && mode !== "cursor" && (
        <div role="status" className="pointer-events-none absolute right-2 top-1 rounded border border-accent bg-surface px-2 py-0.5 text-[11px] font-medium text-accent">
          {dict.chart.drawNeed.replace("{n}", String(TOOL_POINTS[mode] - pending.length))}
        </div>
      )}

      {hover !== null && (
        <div role="status" className="pointer-events-none absolute top-1 rounded border border-line bg-surface px-2 py-1 text-[11px] shadow-sm"
          style={{ left: Math.min(Math.max(x(hover) - 55, 0), Math.max(0, width - 120)) }}>
          <div className="font-medium">{stamp(view[idx].t, locale, intraday)}</div>
          <div className="tnum text-ink-2">{num(view[idx].c, locale, digits)}</div>
        </div>
      )}
    </div>
  );
}

function VolumePane({ view, width, band, x, PAD, hover, locale }: PaneGeom & { locale: Locale }) {
  const H = 56;
  const maxV = Math.max(...view.map((b) => b.v), 1);
  if (maxV <= 1) return null;
  return (
    <svg width="100%" height={H} viewBox={`0 0 ${width} ${H}`} role="img" aria-label={`Volume`} className="block">
      {(() => {
        const p = volumePaths(view, {
          x, barWidth: Math.max(1, Math.min(band * 0.62, 14)), height: H, maxVolume: maxV,
        });
        return (
          <g opacity={0.32}>
            <path d={p.up} fill="var(--up)" />
            <path d={p.down} fill="var(--down)" />
          </g>
        );
      })()}
      {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={0} y2={H} stroke="var(--axis)" strokeWidth={1} />}
      <text x={PAD.left} y={10} fontSize={9} fill="var(--muted)">VOL {fmtVol(maxV, locale)}</text>
    </svg>
  );
}

/**
 * Foreign net buy/sell (khối ngoại), one signed bar per session about a zero
 * line: green above for a net-buy day, red below for a net-sell day. Its own
 * pane and its own scale — it never touches price. A missing session (null)
 * simply has no bar; nothing is drawn as a fake zero.
 */
function ForeignPane({
  width, band, x, PAD, hover, net, label,
}: PaneGeom & { net: (number | null)[]; label: string; locale: Locale }) {
  const H = 54;
  const mid = H / 2;
  const vals = net.filter((v): v is number => v !== null);
  const maxAbs = Math.max(1, ...vals.map((v) => Math.abs(v)));
  const bw = Math.max(1, Math.min(band * 0.62, 14));
  return (
    <svg width="100%" height={H} viewBox={`0 0 ${width} ${H}`} role="img" aria-label={label} className="block">
      <line x1={PAD.left} x2={PAD.left + (width - PAD.left - PAD.right)} y1={mid} y2={mid} stroke="var(--grid)" strokeWidth={1} />
      {net.map((v, i) => {
        if (v === null || v === 0) return null;
        const h = (Math.abs(v) / maxAbs) * (mid - 6);
        const up = v > 0;
        return (
          <rect
            key={i}
            x={x(i) - bw / 2} width={bw}
            y={up ? mid - h : mid} height={h}
            className={up ? "text-up" : "text-down"} fill="currentColor" opacity={0.55}
          />
        );
      })}
      {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={0} y2={H} stroke="var(--axis)" strokeWidth={1} />}
      <text x={PAD.left} y={10} fontSize={9} fill="var(--muted)">{label}</text>
    </svg>
  );
}

/**
 * Breadth, 0–100. Bounded, so the scale is fixed rather than fitted to the
 * window — a breadth chart that rescales itself makes 60% look like an extreme
 * on a quiet week. The 50 line is drawn because it is a genuine midpoint (half
 * the market participating), not a threshold someone picked.
 */
function BreadthPane({
  width, x, PAD, hover, pct, label,
}: PaneGeom & { pct: (number | null)[]; label: string; locale: Locale }) {
  const H = 54;
  const plotW = width - PAD.left - PAD.right;
  const y = (v: number) => 8 + (H - 16) - (v / 100) * (H - 16);
  const d = pct
    .map((v, i) => (v === null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`))
    .filter(Boolean)
    .map((pt, i) => `${i === 0 ? "M" : "L"}${pt}`)
    .join(" ");
  const last = [...pct].reverse().find((v): v is number => v !== null);
  return (
    <svg width="100%" height={H} viewBox={`0 0 ${width} ${H}`} role="img" aria-label={label} className="block">
      <line x1={PAD.left} x2={PAD.left + plotW} y1={y(50)} y2={y(50)} stroke="var(--grid)" strokeWidth={1} strokeDasharray="2 3" />
      {d && <path d={d} fill="none" stroke="var(--accent)" strokeWidth={1.5} />}
      {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={0} y2={H} stroke="var(--axis)" strokeWidth={1} />}
      <text x={PAD.left} y={10} fontSize={9} fill="var(--muted)">{label}</text>
      {last !== undefined && (
        <text x={PAD.left + plotW - 2} y={10} fontSize={9} textAnchor="end" fill="var(--muted)" className="tnum">
          {Math.round(last)}%
        </text>
      )}
    </svg>
  );
}

function OscillatorPane({
  def, plots, width, band, x, PAD, hover, idx, locale,
}: Omit<PaneGeom, "view"> & { def: IndicatorDef; plots: Plot[]; idx: number; locale: Locale }) {
  const H = 96;
  const vals = plots.flatMap((p) => p.series.filter((v): v is number => v !== null));
  if (!vals.length) return null;
  const [lo, hi] = def.range ?? [Math.min(...vals), Math.max(...vals)];
  const span = hi - lo || 1;
  const y = (v: number) => 14 + (H - 24) - ((v - lo) / span) * (H - 24);
  const zeroY = lo < 0 && hi > 0 ? y(0) : H - 10;

  return (
    <svg width="100%" height={H} viewBox={`0 0 ${width} ${H}`} role="img" aria-label={def.label} className="block border-t border-line">
      {/* The plot labels already name the indicator; printing `def.short` too
          produced "RSI RSI 14". */}
      <text x={PAD.left} y={11} fontSize={10} fill="var(--muted)">
        {plots
          .map((p) => (p.series[idx] === null ? null : `${p.label} ${num(p.series[idx]!, locale, 2)}`))
          .filter(Boolean)
          .join("   ") || def.short}
      </text>

      {(def.guides ?? []).map((g) => (
        <g key={g}>
          <line x1={PAD.left} x2={width - PAD.right} y1={y(g)} y2={y(g)} stroke="var(--grid)" strokeWidth={1} />
          <text x={width - PAD.right + 6} y={y(g) + 3} fontSize={9} fill="var(--muted)" className="tnum">{g}</text>
        </g>
      ))}

      {plots.map((p) =>
        p.style === "histogram" ? (
          <g key={p.key}>
            {p.series.map((v, i) =>
              v === null ? null : (
                <rect key={i} x={x(i) - Math.min(band * 0.5, 5)} y={Math.min(y(v), zeroY)}
                  width={Math.max(1, Math.min(band * 1.0, 10))} height={Math.max(0.5, Math.abs(y(v) - zeroY))}
                  fill={v >= 0 ? "var(--up)" : "var(--down)"} opacity={0.45} />
              ),
            )}
          </g>
        ) : (
          <path key={p.key}
            d={p.series.map((v, i) => (v === null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`))
              .filter(Boolean).map((pt, i) => `${i === 0 ? "M" : "L"}${pt}`).join(" ")}
            fill="none" stroke={COLOR_VAR[p.color]} strokeWidth={1.5} />
        ),
      )}

      {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={0} y2={H} stroke="var(--axis)" strokeWidth={1} />}
    </svg>
  );
}

function XAxis({ view, width, x, xStep, locale, hover, intraday }: { view: Bar[]; width: number; x: (i: number) => number; xStep: number; locale: Locale; hover: number | null; intraday: boolean }) {
  // An intraday axis that printed only the clock would repeat "09:00" at every
  // tick once the window spans more than a day, which tells the reader nothing.
  // Ticks that open a new trading day carry the date; ticks inside a day carry
  // the clock — the way a terminal axis reads.
  const ticks: { i: number; label: string }[] = [];
  let lastDay = "";
  for (let i = 0; i < view.length - 1; i++) {
    if (i % xStep !== 0) continue;
    const day = dateOnly(view[i].t, locale).slice(0, 5);
    ticks.push({
      i,
      label: !intraday || day !== lastDay ? day : barTime(view[i].t, locale),
    });
    lastDay = day;
  }

  return (
    <svg width="100%" height={20} viewBox={`0 0 ${width} 20`} aria-hidden="true" className="block">
      {hover !== null && (
        <g>
          <rect x={Math.max(0, x(hover) - (intraday ? 34 : 26))} y={1} width={intraday ? 68 : 52} height={16} rx={2} fill="var(--ink)" />
          <text x={Math.max(intraday ? 34 : 26, x(hover))} y={12.5} fontSize={9.5} textAnchor="middle" fill="var(--page)" className="tnum">
            {stamp(view[hover].t, locale, intraday)}
          </text>
        </g>
      )}
      {ticks.map((t) => (
        <text key={view[t.i].t} x={Math.max(x(t.i), 18)} y={13} fontSize={10} textAnchor="middle" fill="var(--muted)">
          {t.label}
        </text>
      ))}
    </svg>
  );
}

function BarTable({ bars, locale, dict, digits, intraday }: { bars: Bar[]; locale: Locale; dict: Dict; digits: number; intraday: boolean }) {
  return (
    <div className="card relative mt-2 max-h-[420px] overflow-auto">
      <table className="data-table tnum w-full text-[12px]">
        <caption className="sr-only">{dict.stocks.chartTitle}</caption>
        <thead className="text-left text-muted">
          <tr>
            <th scope="col" className="px-2 font-medium">{dict.common.updated}</th>
            <th scope="col" className="px-2 text-right font-medium">{dict.common.open}</th>
            <th scope="col" className="px-2 text-right font-medium">{dict.common.high}</th>
            <th scope="col" className="px-2 text-right font-medium">{dict.common.low}</th>
            <th scope="col" className="px-2 text-right font-medium">{dict.common.price}</th>
            <th scope="col" className="px-2 text-right font-medium">{dict.common.volume}</th>
          </tr>
        </thead>
        <tbody>
          {[...bars].reverse().map((b) => (
            <tr key={b.t} className="border-t border-line">
              <td className="px-2">{stamp(b.t, locale, intraday)}</td>
              <td className="px-2 text-right">{num(b.o, locale, digits)}</td>
              <td className="px-2 text-right">{num(b.h, locale, digits)}</td>
              <td className="px-2 text-right">{num(b.l, locale, digits)}</td>
              <td className={`px-2 text-right ${b.c >= b.o ? "text-up" : "text-down"}`}>
                <span aria-hidden="true">{b.c >= b.o ? "▲" : "▼"}</span> {num(b.c, locale, digits)}
              </td>
              <td className="px-2 text-right text-ink-2">{b.v ? fmtVol(b.v, locale) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
