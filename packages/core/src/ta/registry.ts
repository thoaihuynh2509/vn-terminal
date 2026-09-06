import type { Bar } from "@/lib/types";
import { atr, bollinger, ema, macd, rsi, sma, vwap, type Series } from "./indicators";
import {
  adx, cci, donchian, keltner, mfi, obv, roc, stochastic, supertrend, williamsR, type OHLCV,
} from "./indicators2";

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
  compute: (bars: Bar[]) => Plot[];
}

const closes = (bars: Bar[]) => bars.map((b) => b.c);
/** Bar already carries OHLCV; this only narrows the type for the second tranche. */
const ohlcv = (bars: Bar[]): OHLCV[] => bars.map((b) => ({ o: b.o, h: b.h, l: b.l, c: b.c, v: b.v }));

export const INDICATORS: IndicatorDef[] = [
  {
    id: "sma20", label: "SMA 20", short: "SMA20", pane: "price", group: "trend", free: true,
    compute: (b) => [{ key: "sma20", label: "SMA 20", series: sma(closes(b), 20), style: "line", color: "accent" }],
  },
  {
    id: "sma50", label: "SMA 50", short: "SMA50", pane: "price", group: "trend", free: false,
    compute: (b) => [{ key: "sma50", label: "SMA 50", series: sma(closes(b), 50), style: "line", color: "muted" }],
  },
  {
    id: "ema20", label: "EMA 20", short: "EMA20", pane: "price", group: "trend", free: false,
    compute: (b) => [{ key: "ema20", label: "EMA 20", series: ema(closes(b), 20), style: "line", color: "up" }],
  },
  {
    id: "bb", label: "Bollinger Bands (20, 2)", short: "BB", pane: "price", group: "volatility", free: false,
    compute: (b) => {
      const x = bollinger(closes(b), 20, 2);
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
    id: "keltner", label: "Keltner Channels (20, 2)", short: "KC", pane: "price", group: "volatility", free: false,
    compute: (b) => {
      const k = keltner(ohlcv(b), 20, 2);
      return [
        { key: "kcu", label: "KC upper", series: k.upper, style: "band", color: "ink-2" },
        { key: "kcm", label: "KC mid", series: k.middle, style: "line", color: "muted" },
        { key: "kcl", label: "KC lower", series: k.lower, style: "band", color: "ink-2" },
      ];
    },
  },
  {
    id: "donchian", label: "Donchian Channels (20)", short: "DC", pane: "price", group: "volatility", free: false,
    compute: (b) => {
      const d = donchian(ohlcv(b), 20);
      return [
        { key: "dcu", label: "DC upper", series: d.upper, style: "band", color: "up" },
        { key: "dcl", label: "DC lower", series: d.lower, style: "band", color: "down" },
      ];
    },
  },
  {
    id: "supertrend", label: "Supertrend (10, 3)", short: "ST", pane: "price", group: "trend", free: false,
    compute: (b) => [{ key: "st", label: "Supertrend", series: supertrend(ohlcv(b), 10, 3).line, style: "line", color: "accent" }],
  },
  {
    id: "stoch", label: "Stochastic (14, 3)", short: "STOCH", pane: "oscillator", group: "momentum", free: false,
    range: [0, 100], guides: [20, 80],
    compute: (b) => {
      const st = stochastic(ohlcv(b), 14, 3);
      return [
        { key: "k", label: "%K", series: st.k, style: "line", color: "accent" },
        { key: "d", label: "%D", series: st.d, style: "line", color: "down" },
      ];
    },
  },
  {
    id: "cci", label: "CCI (20)", short: "CCI", pane: "oscillator", group: "momentum", free: false, guides: [-100, 0, 100],
    compute: (b) => [{ key: "cci", label: "CCI 20", series: cci(ohlcv(b), 20), style: "line", color: "accent" }],
  },
  {
    id: "willr", label: "Williams %R (14)", short: "%R", pane: "oscillator", group: "momentum", free: false,
    range: [-100, 0], guides: [-80, -20],
    compute: (b) => [{ key: "wr", label: "%R", series: williamsR(ohlcv(b), 14), style: "line", color: "accent" }],
  },
  {
    id: "adx", label: "ADX / DMI (14)", short: "ADX", pane: "oscillator", group: "trend", free: false, guides: [25],
    compute: (b) => {
      const a = adx(ohlcv(b), 14);
      return [
        { key: "adx", label: "ADX", series: a.adx, style: "line", color: "accent" },
        { key: "pdi", label: "+DI", series: a.plusDI, style: "line", color: "up" },
        { key: "mdi", label: "-DI", series: a.minusDI, style: "line", color: "down" },
      ];
    },
  },
  {
    id: "mfi", label: "Money Flow Index (14)", short: "MFI", pane: "oscillator", group: "volume", free: false,
    range: [0, 100], guides: [20, 80],
    compute: (b) => [{ key: "mfi", label: "MFI 14", series: mfi(ohlcv(b), 14), style: "line", color: "accent" }],
  },
  {
    id: "obv", label: "On-Balance Volume", short: "OBV", pane: "oscillator", group: "volume", free: false,
    compute: (b) => [{ key: "obv", label: "OBV", series: obv(ohlcv(b)), style: "line", color: "muted" }],
  },
  {
    id: "roc", label: "Rate of Change (12)", short: "ROC", pane: "oscillator", group: "momentum", free: false, guides: [0],
    compute: (b) => [{ key: "roc", label: "ROC 12", series: roc(closes(b), 12), style: "line", color: "accent" }],
  },
  {
    id: "rsi", label: "RSI (14)", short: "RSI", pane: "oscillator", group: "momentum", free: true,
    range: [0, 100], guides: [30, 70],
    compute: (b) => [{ key: "rsi", label: "RSI 14", series: rsi(closes(b), 14), style: "line", color: "accent" }],
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
    id: "atr", label: "ATR (14)", short: "ATR", pane: "oscillator", group: "volatility", free: false,
    compute: (b) => [{ key: "atr", label: "ATR 14", series: atr(b, 14), style: "line", color: "muted" }],
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
