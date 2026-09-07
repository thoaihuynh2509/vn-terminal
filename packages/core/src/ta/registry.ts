import type { Bar } from "@/lib/types";
import { atr, bollinger, ema, macd, rsi, sma, vwap, type Series } from "./indicators.ts";
import {
  adx, cci, donchian, keltner, mfi, obv, roc, stochastic, supertrend, williamsR, type OHLCV,
} from "./indicators2.ts";

/**
 * The indicator catalogue.
 *
 * One registry drives the toolbar, the entitlement gate and the renderer, so a
 * new indicator is added in exactly one place and cannot appear in the UI
 * without the chart knowing how to draw it.
 */
export type PaneKind = "price" | "oscillator";
/** Menu grouping — how a terminal's indicator list is organised. */
export type IndicatorGroup = "trend" | "momentum" | "volume" | "volatility";
export const INDICATOR_GROUPS: IndicatorGroup[] = ["trend", "momentum", "volume", "volatility"];

export interface Plot {
  key: string;
  label: string;
  series: Series;
  /** How the renderer should draw it. */
  style: "line" | "histogram" | "band";
  /** Token name, resolved to a CSS variable at render time. */
  color: "accent" | "up" | "down" | "muted" | "ink-2";
}

export interface IndicatorDef {
  id: string;
  label: string;
  short: string;
  pane: PaneKind;
  group: IndicatorGroup;
  /** Free tier gets a taste; the rest require an entitlement. */
  free: boolean;
  /** Fixed y-range for oscillators that have one (RSI is 0..100). */
  range?: [number, number];
  /** Reference lines drawn behind the plot (RSI 30/70, MACD zero). */
  guides?: number[];
  /**
   * The one period a reader may tune, when the indicator has a single obvious
   * one. Absent for MACD (three periods, no primary), VWAP and OBV (none).
   * `label`/`short` on such a def carry the BASE name: the number a reader sees
   * comes from the period in use, never from a string welded into the catalogue.
   */
  param?: { default: number; min: number; max: number };
  /** `period` is the resolved value; defs without a `param` receive 0 and ignore it. */
  compute: (bars: Bar[], period: number) => Plot[];
}

const closes = (bars: Bar[]) => bars.map((b) => b.c);
/** Bar already carries OHLCV; this only narrows the type for the second tranche. */
const ohlcv = (bars: Bar[]): OHLCV[] => bars.map((b) => ({ o: b.o, h: b.h, l: b.l, c: b.c, v: b.v }));

export const INDICATORS: IndicatorDef[] = [
  {
    id: "sma20", label: "SMA", short: "SMA", pane: "price", group: "trend", free: true,
    param: { default: 20, min: 2, max: 400 },
    compute: (b, p) => [{ key: "sma20", label: `SMA ${p}`, series: sma(closes(b), p), style: "line", color: "accent" }],
  },
  {
    id: "sma50", label: "SMA", short: "SMA", pane: "price", group: "trend", free: false,
    param: { default: 50, min: 2, max: 400 },
    compute: (b, p) => [{ key: "sma50", label: `SMA ${p}`, series: sma(closes(b), p), style: "line", color: "muted" }],
  },
  {
    id: "ema20", label: "EMA", short: "EMA", pane: "price", group: "trend", free: false,
    param: { default: 20, min: 2, max: 400 },
    compute: (b, p) => [{ key: "ema20", label: `EMA ${p}`, series: ema(closes(b), p), style: "line", color: "up" }],
  },
  {
    id: "bb", label: "Bollinger Bands", short: "BB", pane: "price", group: "volatility", free: false,
    param: { default: 20, min: 5, max: 200 },
    compute: (b, p) => {
      const x = bollinger(closes(b), p, 2);
      return [
        { key: "bbu", label: "BB upper", series: x.upper, style: "band", color: "ink-2" },
        { key: "bbm", label: "BB mid", series: x.middle, style: "line", color: "muted" },
        { key: "bbl", label: "BB lower", series: x.lower, style: "band", color: "ink-2" },
      ];
    },
  },
  {
    id: "vwap", label: "VWAP", short: "VWAP", pane: "price", group: "trend", free: false,
    compute: (b) => [{ key: "vwap", label: "VWAP", series: vwap(b), style: "line", color: "accent" }],
  },
  {
    id: "keltner", label: "Keltner Channels", short: "KC", pane: "price", group: "volatility", free: false,
    param: { default: 20, min: 5, max: 200 },
    compute: (b, p) => {
      const k = keltner(ohlcv(b), p, 2);
      return [
        { key: "kcu", label: "KC upper", series: k.upper, style: "band", color: "ink-2" },
        { key: "kcm", label: "KC mid", series: k.middle, style: "line", color: "muted" },
        { key: "kcl", label: "KC lower", series: k.lower, style: "band", color: "ink-2" },
      ];
    },
  },
  {
    id: "donchian", label: "Donchian Channels", short: "DC", pane: "price", group: "volatility", free: false,
    param: { default: 20, min: 2, max: 200 },
    compute: (b, p) => {
      const d = donchian(ohlcv(b), p);
      return [
        { key: "dcu", label: "DC upper", series: d.upper, style: "band", color: "up" },
        { key: "dcl", label: "DC lower", series: d.lower, style: "band", color: "down" },
      ];
    },
  },
  {
    id: "supertrend", label: "Supertrend", short: "ST", pane: "price", group: "trend", free: false,
    param: { default: 10, min: 2, max: 100 },
    compute: (b, p) => [{ key: "st", label: `Supertrend ${p}`, series: supertrend(ohlcv(b), p, 3).line, style: "line", color: "accent" }],
  },
  {
    id: "stoch", label: "Stochastic", short: "STOCH", pane: "oscillator", group: "momentum", free: false,
    range: [0, 100], guides: [20, 80], param: { default: 14, min: 2, max: 100 },
    compute: (b, p) => {
      const st = stochastic(ohlcv(b), p, 3);
      return [
        { key: "k", label: "%K", series: st.k, style: "line", color: "accent" },
        { key: "d", label: "%D", series: st.d, style: "line", color: "down" },
      ];
    },
  },
  {
    id: "cci", label: "CCI", short: "CCI", pane: "oscillator", group: "momentum", free: false, guides: [-100, 0, 100],
    param: { default: 20, min: 2, max: 200 },
    compute: (b, p) => [{ key: "cci", label: `CCI ${p}`, series: cci(ohlcv(b), p), style: "line", color: "accent" }],
  },
  {
    id: "willr", label: "Williams %R", short: "%R", pane: "oscillator", group: "momentum", free: false,
    range: [-100, 0], guides: [-80, -20], param: { default: 14, min: 2, max: 200 },
    compute: (b, p) => [{ key: "wr", label: `%R ${p}`, series: williamsR(ohlcv(b), p), style: "line", color: "accent" }],
  },
  {
    id: "adx", label: "ADX / DMI", short: "ADX", pane: "oscillator", group: "trend", free: false, guides: [25],
    param: { default: 14, min: 2, max: 100 },
    compute: (b, p) => {
      const a = adx(ohlcv(b), p);
      return [
        { key: "adx", label: "ADX", series: a.adx, style: "line", color: "accent" },
        { key: "pdi", label: "+DI", series: a.plusDI, style: "line", color: "up" },
        { key: "mdi", label: "-DI", series: a.minusDI, style: "line", color: "down" },
      ];
    },
  },
  {
    id: "mfi", label: "Money Flow Index", short: "MFI", pane: "oscillator", group: "volume", free: false,
    range: [0, 100], guides: [20, 80], param: { default: 14, min: 2, max: 200 },
    compute: (b, p) => [{ key: "mfi", label: `MFI ${p}`, series: mfi(ohlcv(b), p), style: "line", color: "accent" }],
  },
  {
    id: "obv", label: "On-Balance Volume", short: "OBV", pane: "oscillator", group: "volume", free: false,
    compute: (b) => [{ key: "obv", label: "OBV", series: obv(ohlcv(b)), style: "line", color: "muted" }],
  },
  {
    id: "roc", label: "Rate of Change", short: "ROC", pane: "oscillator", group: "momentum", free: false, guides: [0],
    param: { default: 12, min: 1, max: 200 },
    compute: (b, p) => [{ key: "roc", label: `ROC ${p}`, series: roc(closes(b), p), style: "line", color: "accent" }],
  },
  {
    id: "rsi", label: "RSI", short: "RSI", pane: "oscillator", group: "momentum", free: true,
    range: [0, 100], guides: [30, 70], param: { default: 14, min: 2, max: 200 },
    compute: (b, p) => [{ key: "rsi", label: `RSI ${p}`, series: rsi(closes(b), p), style: "line", color: "accent" }],
  },
  {
    id: "macd", label: "MACD (12, 26, 9)", short: "MACD", pane: "oscillator", group: "momentum", free: false,
    guides: [0],
    compute: (b) => {
      const m = macd(closes(b));
      return [
        { key: "macdh", label: "Histogram", series: m.histogram, style: "histogram", color: "muted" },
        { key: "macd", label: "MACD", series: m.macd, style: "line", color: "accent" },
        { key: "macds", label: "Signal", series: m.signal, style: "line", color: "down" },
      ];
    },
  },
  {
    id: "atr", label: "ATR", short: "ATR", pane: "oscillator", group: "volatility", free: false,
    param: { default: 14, min: 1, max: 200 },
    compute: (b, p) => [{ key: "atr", label: `ATR ${p}`, series: atr(b, p), style: "line", color: "muted" }],
  },
];

export function getIndicator(id: string): IndicatorDef | undefined {
  return INDICATORS.find((i) => i.id === id);
}

export const COLOR_VAR: Record<Plot["color"], string> = {
  accent: "var(--accent)",
  up: "var(--up)",
  down: "var(--down)",
  muted: "var(--muted)",
  "ink-2": "var(--ink-2)",
};
