import type { Dir, Locale } from "./types";

const tag = (l: Locale) => (l === "vi" ? "vi-VN" : "en-US");

/**
 * Direction of a change, at the precision it will actually be DISPLAYED.
 *
 * A feed can report a move like +0.0004%, which rounds to "0,00%" — painting a
 * green ▲ next to a zero is simply wrong. Anything that rounds to
 * zero at `digits` is flat, so the glyph always agrees with the number beside it.
 */
export function dirOf(change: number, digits = 2): Dir {
  const epsilon = 0.5 * Math.pow(10, -digits);
  if (change >= epsilon) return "up";
  if (change <= -epsilon) return "down";
  return "flat";
}

/** ▲ / ▼ / — . The glyph is the secondary encoding that lets the up/down hues
 *  sit in the 6–8 CVD band legally: direction is never carried by color alone. */
export function arrow(dir: Dir): string {
  return dir === "up" ? "▲" : dir === "down" ? "▼" : "—";
}

/** Tailwind text class for a direction. `flat` deliberately stays neutral ink. */
export function dirClass(dir: Dir): string {
  return dir === "up" ? "text-up" : dir === "down" ? "text-down" : "text-ink-2";
}

/**
 * Deterministic decimal formatting — grouping and decimal separators are chosen
 * by us, NOT by `Intl.NumberFormat`'s ICU locale data.
 *
 * Why not Intl: a trimmed server runtime (e.g. serverless) can resolve the
 * `vi-VN` grouping separator differently from the visitor's browser — "99.000"
 * vs "99,000". When such a string is produced inside a client component, the
 * server-rendered markup and the browser's first render disagree, React aborts
 * hydration, and the whole route shows a generic client-side exception. Forming
 * the digit string ourselves makes the output byte-identical on every runtime,
 * which is the only way to keep hydration safe. (Currency and dates below still
 * use Intl — they are not rendered thousand-grouped inside a client component.)
 */
function seps(locale: Locale): { grp: string; dec: string } {
  return locale === "vi" ? { grp: ".", dec: "," } : { grp: ",", dec: "." };
}

function groupInt(intPart: string, grp: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, grp);
}

function fmt(v: number, locale: Locale, opts: { digits?: number; signed?: boolean } = {}): string {
  const { grp, dec } = seps(locale);
  const abs = Math.abs(v);
  // `digits` undefined mirrors Intl's decimal default: up to 3 fraction digits,
  // trailing zeros trimmed. Fixed `digits` keeps the zeros (e.g. "1,50").
  const raw = opts.digits === undefined ? abs.toFixed(3) : abs.toFixed(opts.digits);
  const dot = raw.indexOf(".");
  let intPart = dot === -1 ? raw : raw.slice(0, dot);
  let frac = dot === -1 ? "" : raw.slice(dot + 1);
  if (opts.digits === undefined) frac = frac.replace(/0+$/, "");
  intPart = groupInt(intPart, grp);
  const body = frac ? `${intPart}${dec}${frac}` : intPart;
  const sign = v < 0 ? "-" : opts.signed && v > 0 ? "+" : "";
  return sign + body;
}

export function num(v: number, locale: Locale, digits = 2): string {
  return fmt(v, locale, { digits });
}

/** Always signed — the sign is part of the non-color encoding of direction. */
export function signed(v: number, locale: Locale, digits = 2): string {
  return fmt(v, locale, { digits, signed: true });
}

export function pct(v: number, locale: Locale, digits = 2): string {
  return `${signed(v, locale, digits)}%`;
}

/** Compact share/contract volume: 1.234.567 → "1,23 tr" (vi) / "1.23M" (en). */
export function volume(v: number, locale: Locale): string {
  const vi = locale === "vi";
  if (v >= 1e9) return `${num(v / 1e9, locale, 2)}${vi ? " tỷ" : "B"}`;
  if (v >= 1e6) return `${num(v / 1e6, locale, 2)}${vi ? " tr" : "M"}`;
  if (v >= 1e3) return `${num(v / 1e3, locale, 1)}${vi ? " ng" : "K"}`;
  return fmt(v, locale);
}

/**
 * VND in full. Gold is quoted per lượng in raw dong (145_100_000), which is
 * unreadable at full width, so anything ≥ 1 triệu is abbreviated.
 */
export function vnd(v: number, locale: Locale): string {
  const vi = locale === "vi";
  if (v >= 1e6) return `${num(v / 1e6, locale, 2)} ${vi ? "triệu" : "M ₫"}`;
  return `${fmt(v, locale)} ${vi ? "đ" : "₫"}`;
}

/**
 * USD keeps Intl currency formatting (symbol placement is locale-specific and
 * this value is never rendered thousand-grouped inside a client component).
 */
const usdCache = new Map<string, Intl.NumberFormat>();
function usdFmt(locale: Locale, digits: number): Intl.NumberFormat {
  const t = tag(locale);
  const key = `${t}:${digits}`;
  let f = usdCache.get(key);
  if (!f) {
    f = new Intl.NumberFormat(t, {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
    usdCache.set(key, f);
  }
  return f;
}

export function usd(v: number, locale: Locale): string {
  const digits = v >= 1000 ? 0 : v >= 1 ? 2 : 6;
  return usdFmt(locale, digits).format(v);
}

/** Market cap / turnover, compact. */
export function compactUsd(v: number, locale: Locale): string {
  const vi = locale === "vi";
  if (v >= 1e12) return `$${num(v / 1e12, locale, 2)}${vi ? " nghìn tỷ" : "T"}`;
  if (v >= 1e9) return `$${num(v / 1e9, locale, 2)}${vi ? " tỷ" : "B"}`;
  if (v >= 1e6) return `$${num(v / 1e6, locale, 2)}${vi ? " triệu" : "M"}`;
  return usd(v, locale);
}

/** VN equities are quoted in thousands of dong: 62.7 on the wire = 62,700 ₫. */
export function equityPrice(v: number, locale: Locale): string {
  return num(v, locale, 2);
}

/**
 * Date/time formatting stays on Intl — it pins an explicit `timeZone`, so the
 * output does not vary with the host's clock, and calendar strings are not
 * rendered in a hydration-sensitive client path the way prices are. The cache
 * avoids rebuilding a formatter per axis tick on a chart pan (a hot path).
 */
const dateCache = new Map<string, Intl.DateTimeFormat>();
function df(t: string, key: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const k = `${t}:${key}`;
  let f = dateCache.get(k);
  if (!f) { f = new Intl.DateTimeFormat(t, opts); dateCache.set(k, f); }
  return f;
}

export function dateTime(iso: string | number, locale: Locale): string {
  const d = typeof iso === "number" ? new Date(iso * 1000) : new Date(iso);
  return df(tag(locale), "dateTime", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Ho_Chi_Minh",
  }).format(d);
}

/** Clock time in exchange-local terms, for intraday bars. */
export function barTime(t: number, locale: Locale): string {
  return df(tag(locale), "barTime", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Ho_Chi_Minh",
  }).format(new Date(t * 1000));
}

export function dateOnly(t: number, locale: Locale): string {
  return df(tag(locale), "dateOnly", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Asia/Ho_Chi_Minh",
  }).format(new Date(t * 1000));
}
