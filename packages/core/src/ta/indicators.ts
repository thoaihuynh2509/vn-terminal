/**
 * Technical indicators.
 *
 * Standard, publicly documented formulas — Wilder's RSI and ATR, Appel's MACD,
 * Bollinger's bands. These are mathematical methods, not anyone's proprietary
 * code, and each is implemented here from its published definition.
 *
 * Every function returns an array the SAME LENGTH as the input, padded with
 * `null` where the indicator is not yet defined. That invariant is what lets the
 * chart align a series to its bars by index without off-by-one bugs, which are
 * the classic way indicator overlays end up drawn one candle out of place.
 */
export type Series = (number | null)[];

const notEnough = (len: number, period: number) => len < period || period < 1;

/** Simple moving average. */
export function sma(values: number[], period: number): Series {
  const out: Series = new Array(values.length).fill(null);
  if (notEnough(values.length, period)) return out;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/** Exponential moving average, seeded with the first SMA so it is deterministic. */
export function ema(values: number[], period: number): Series {
  const out: Series = new Array(values.length).fill(null);
  if (notEnough(values.length, period)) return out;
  const k = 2 / (period + 1);
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** Population standard deviation over a rolling window. */
export function stddev(values: number[], period: number): Series {
  const out: Series = new Array(values.length).fill(null);
  if (notEnough(values.length, period)) return out;
  for (let i = period - 1; i < values.length; i++) {
    const win = values.slice(i - period + 1, i + 1);
    const mean = win.reduce((a, b) => a + b, 0) / period;
    out[i] = Math.sqrt(win.reduce((s, v) => s + (v - mean) ** 2, 0) / period);
  }
  return out;
}

export interface Bands { upper: Series; middle: Series; lower: Series }

/** Bollinger Bands: an SMA with a symmetric standard-deviation envelope. */
export function bollinger(values: number[], period = 20, mult = 2): Bands {
  const middle = sma(values, period);
  const sd = stddev(values, period);
  const upper: Series = middle.map((m, i) => (m === null || sd[i] === null ? null : m + mult * sd[i]!));
  const lower: Series = middle.map((m, i) => (m === null || sd[i] === null ? null : m - mult * sd[i]!));
  return { upper, middle, lower };
}

/**
 * Wilder's RSI. The smoothing is Wilder's, not a simple average: the first
 * value seeds from a plain mean of `period` changes, and every value after uses
 * (prev * (period - 1) + current) / period. Using a simple moving average here
 * is a common error that produces a visibly different, jumpier line.
 */
export function rsi(values: number[], period = 14): Series {
  const out: Series = new Array(values.length).fill(null);
  if (values.length <= period) return out;

  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(d, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

export interface Macd { macd: Series; signal: Series; histogram: Series }

/** MACD: fast EMA − slow EMA, with an EMA signal line and their difference. */
export function macd(values: number[], fast = 12, slow = 26, signalPeriod = 9): Macd {
  const fastLine = ema(values, fast);
  const slowLine = ema(values, slow);
  const line: Series = values.map((_, i) =>
    fastLine[i] === null || slowLine[i] === null ? null : fastLine[i]! - slowLine[i]!,
  );

  // The signal EMA runs over the defined part of the MACD line only, then is
  // mapped back to the original indices so everything stays index-aligned.
  const defined = line.filter((v): v is number => v !== null);
  const firstIdx = line.findIndex((v) => v !== null);
  const sigCompact = ema(defined, signalPeriod);
  const signal: Series = new Array(values.length).fill(null);
  if (firstIdx >= 0) sigCompact.forEach((v, i) => { signal[firstIdx + i] = v; });

  const histogram: Series = line.map((v, i) => (v === null || signal[i] === null ? null : v - signal[i]!));
  return { macd: line, signal, histogram };
}

export interface Bar { h: number; l: number; c: number; v?: number }

/** Wilder's Average True Range — a volatility measure, not a direction signal. */
export function atr(bars: Bar[], period = 14): Series {
  const out: Series = new Array(bars.length).fill(null);
  if (bars.length <= period) return out;

  const tr: number[] = [bars[0].h - bars[0].l];
  for (let i = 1; i < bars.length; i++) {
    const { h, l } = bars[i];
    const pc = bars[i - 1].c;
    tr.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }

  let prev = tr.slice(1, period + 1).reduce((a, b) => a + b, 0) / period;
  out[period] = prev;
  for (let i = period + 1; i < bars.length; i++) {
    prev = (prev * (period - 1) + tr[i]) / period;
    out[i] = prev;
  }
  return out;
}

/** Volume-weighted average price, accumulated across the supplied window. */
export function vwap(bars: Bar[]): Series {
  const out: Series = new Array(bars.length).fill(null);
  let pv = 0;
  let vol = 0;
  for (let i = 0; i < bars.length; i++) {
    const typical = (bars[i].h + bars[i].l + bars[i].c) / 3;
    const v = bars[i].v ?? 0;
    pv += typical * v;
    vol += v;
    out[i] = vol > 0 ? pv / vol : null;
  }
  return out;
}
