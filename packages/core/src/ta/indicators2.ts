import { ema, sma, type Series } from "./indicators.ts";

/**
 * Second tranche of indicators, each from its published definition:
 * Lane's Stochastic, Lambert's CCI, Williams %R, Wilder's ADX and Parabolic SAR,
 * Granville's OBV, Donchian's channel, Keltner's channel.
 *
 * Same invariant as `indicators.ts`: every series is returned at the input's
 * length, `null` where undefined, so overlays stay index-aligned with the bars.
 */
export interface OHLCV { o: number; h: number; l: number; c: number; v: number }

const hh = (bars: OHLCV[], i: number, n: number) =>
  Math.max(...bars.slice(Math.max(0, i - n + 1), i + 1).map((b) => b.h));
const ll = (bars: OHLCV[], i: number, n: number) =>
  Math.min(...bars.slice(Math.max(0, i - n + 1), i + 1).map((b) => b.l));

export interface Stoch { k: Series; d: Series }

/** Lane's Stochastic: where the close sits inside the recent high-low range. */
export function stochastic(bars: OHLCV[], period = 14, smoothD = 3): Stoch {
  const k: Series = new Array(bars.length).fill(null);
  for (let i = period - 1; i < bars.length; i++) {
    const high = hh(bars, i, period);
    const low = ll(bars, i, period);
    const span = high - low;
    // A flat range has no meaningful position; 50 is the neutral convention.
    k[i] = span === 0 ? 50 : ((bars[i].c - low) / span) * 100;
  }
  const defined = k.filter((v): v is number => v !== null);
  const first = k.findIndex((v) => v !== null);
  const dCompact = sma(defined, smoothD);
  const d: Series = new Array(bars.length).fill(null);
  if (first >= 0) dCompact.forEach((v, i) => { d[first + i] = v; });
  return { k, d };
}

/** Lambert's CCI. The 0.015 constant is part of the published definition. */
export function cci(bars: OHLCV[], period = 20): Series {
  const out: Series = new Array(bars.length).fill(null);
  const tp = bars.map((b) => (b.h + b.l + b.c) / 3);
  const avg = sma(tp, period);
  for (let i = period - 1; i < bars.length; i++) {
    const win = tp.slice(i - period + 1, i + 1);
    const mean = avg[i]!;
    const meanDev = win.reduce((s, v) => s + Math.abs(v - mean), 0) / period;
    out[i] = meanDev === 0 ? 0 : (tp[i] - mean) / (0.015 * meanDev);
  }
  return out;
}

/** Williams %R — the Stochastic's mirror, running 0 (top) to -100 (bottom). */
export function williamsR(bars: OHLCV[], period = 14): Series {
  const out: Series = new Array(bars.length).fill(null);
  for (let i = period - 1; i < bars.length; i++) {
    const high = hh(bars, i, period);
    const low = ll(bars, i, period);
    const span = high - low;
    out[i] = span === 0 ? -50 : ((high - bars[i].c) / span) * -100;
  }
  return out;
}

/** Rate of change, as a percentage of the price `period` bars ago. */
export function roc(values: number[], period = 12): Series {
  const out: Series = new Array(values.length).fill(null);
  for (let i = period; i < values.length; i++) {
    const base = values[i - period];
    out[i] = base === 0 ? null : ((values[i] - base) / base) * 100;
  }
  return out;
}

/** Granville's On-Balance Volume: volume signed by the day's direction. */
export function obv(bars: OHLCV[]): Series {
  const out: Series = new Array(bars.length).fill(null);
  if (!bars.length) return out;
  let acc = 0;
  out[0] = 0;
  for (let i = 1; i < bars.length; i++) {
    if (bars[i].c > bars[i - 1].c) acc += bars[i].v;
    else if (bars[i].c < bars[i - 1].c) acc -= bars[i].v;
    out[i] = acc;
  }
  return out;
}

/** Money Flow Index — a volume-weighted RSI on the typical price. */
export function mfi(bars: OHLCV[], period = 14): Series {
  const out: Series = new Array(bars.length).fill(null);
  const tp = bars.map((b) => (b.h + b.l + b.c) / 3);
  for (let i = period; i < bars.length; i++) {
    let pos = 0;
    let neg = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const flow = tp[j] * bars[j].v;
      if (tp[j] > tp[j - 1]) pos += flow;
      else if (tp[j] < tp[j - 1]) neg += flow;
    }
    out[i] = neg === 0 ? 100 : 100 - 100 / (1 + pos / neg);
  }
  return out;
}

export interface Channel { upper: Series; middle: Series; lower: Series }

/** Donchian channel: the highest high and lowest low of the window. */
export function donchian(bars: OHLCV[], period = 20): Channel {
  const upper: Series = new Array(bars.length).fill(null);
  const lower: Series = new Array(bars.length).fill(null);
  const middle: Series = new Array(bars.length).fill(null);
  for (let i = period - 1; i < bars.length; i++) {
    upper[i] = hh(bars, i, period);
    lower[i] = ll(bars, i, period);
    middle[i] = (upper[i]! + lower[i]!) / 2;
  }
  return { upper, middle, lower };
}

/** Wilder's true range for one bar. */
function trueRange(bars: OHLCV[], i: number): number {
  if (i === 0) return bars[0].h - bars[0].l;
  const pc = bars[i - 1].c;
  return Math.max(bars[i].h - bars[i].l, Math.abs(bars[i].h - pc), Math.abs(bars[i].l - pc));
}

/** Keltner channel: an EMA with an ATR-scaled envelope. */
export function keltner(bars: OHLCV[], period = 20, mult = 2): Channel {
  const middle = ema(bars.map((b) => b.c), period);
  const tr = bars.map((_, i) => trueRange(bars, i));
  const atrS = ema(tr, period);
  const upper: Series = middle.map((m, i) => (m === null || atrS[i] === null ? null : m + mult * atrS[i]!));
  const lower: Series = middle.map((m, i) => (m === null || atrS[i] === null ? null : m - mult * atrS[i]!));
  return { upper, middle, lower };
}

export interface Adx { adx: Series; plusDI: Series; minusDI: Series }

/** Wilder's ADX with its directional indicators. Measures trend STRENGTH only. */
export function adx(bars: OHLCV[], period = 14): Adx {
  const n = bars.length;
  const out: Adx = {
    adx: new Array(n).fill(null),
    plusDI: new Array(n).fill(null),
    minusDI: new Array(n).fill(null),
  };
  if (n <= period * 2) return out;

  const plusDM: number[] = [0];
  const minusDM: number[] = [0];
  const tr: number[] = [trueRange(bars, 0)];
  for (let i = 1; i < n; i++) {
    const up = bars[i].h - bars[i - 1].h;
    const down = bars[i - 1].l - bars[i].l;
    plusDM.push(up > down && up > 0 ? up : 0);
    minusDM.push(down > up && down > 0 ? down : 0);
    tr.push(trueRange(bars, i));
  }

  const wilder = (src: number[]) => {
    const s: Series = new Array(n).fill(null);
    let acc = src.slice(1, period + 1).reduce((a, b) => a + b, 0);
    s[period] = acc;
    for (let i = period + 1; i < n; i++) {
      acc = acc - acc / period + src[i];
      s[i] = acc;
    }
    return s;
  };

  const trS = wilder(tr);
  const pS = wilder(plusDM);
  const mS = wilder(minusDM);
  const dx: Series = new Array(n).fill(null);

  for (let i = period; i < n; i++) {
    if (!trS[i]) continue;
    const p = (pS[i]! / trS[i]!) * 100;
    const m = (mS[i]! / trS[i]!) * 100;
    out.plusDI[i] = p;
    out.minusDI[i] = m;
    dx[i] = p + m === 0 ? 0 : (Math.abs(p - m) / (p + m)) * 100;
  }

  const firstDx = dx.findIndex((v) => v !== null);
  if (firstDx < 0 || firstDx + period >= n) return out;
  let prev = dx.slice(firstDx, firstDx + period).reduce<number>((a, b) => a + (b ?? 0), 0) / period;
  out.adx[firstDx + period - 1] = prev;
  for (let i = firstDx + period; i < n; i++) {
    prev = (prev * (period - 1) + (dx[i] ?? 0)) / period;
    out.adx[i] = prev;
  }
  return out;
}

export interface Supertrend { line: Series; direction: Series }

/** Supertrend: an ATR band that flips side when price closes through it. */
export function supertrend(bars: OHLCV[], period = 10, mult = 3): Supertrend {
  const n = bars.length;
  const line: Series = new Array(n).fill(null);
  const direction: Series = new Array(n).fill(null);
  if (n <= period) return { line, direction };

  const tr = bars.map((_, i) => trueRange(bars, i));
  const atrS = ema(tr, period);

  let upper = 0;
  let lower = 0;
  let dir = 1;
  for (let i = period; i < n; i++) {
    if (atrS[i] === null) continue;
    const mid = (bars[i].h + bars[i].l) / 2;
    const bUpper = mid + mult * atrS[i]!;
    const bLower = mid - mult * atrS[i]!;
    // Bands only tighten while the trend holds; they reset on a flip.
    upper = i > period && bars[i - 1].c <= upper ? Math.min(bUpper, upper) : bUpper;
    lower = i > period && bars[i - 1].c >= lower ? Math.max(bLower, lower) : bLower;
    if (bars[i].c > upper) dir = 1;
    else if (bars[i].c < lower) dir = -1;
    direction[i] = dir;
    line[i] = dir === 1 ? lower : upper;
  }
  return { line, direction };
}
