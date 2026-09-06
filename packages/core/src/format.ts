import type { Dir, Locale } from "./types";

const tag = (l: Locale) => (l === "vi" ? "vi-VN" : "en-US");

/**
 * Direction of a change, at the precision it will actually be DISPLAYED.
 *
 * CoinGecko reports stablecoin moves like +0.0004%, which rounds to "0,00%" —
 * painting a green ▲ next to a zero is simply wrong. Anything that rounds to
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
 * Formatter cache.
 *
 * `new Intl.NumberFormat(...)` is expensive — it resolves locale data on every
 * construction. A chart calls these formatters hundreds of times per frame (one
 * per axis tick, per read-out, per Fibonacci level), and a CPU profile of a pan
 * put `num` and `dateOnly` among the hottest functions in the page purely from
 * rebuilding formatters that never change. Keyed by the arguments that vary.
 */
const numCache = new Map<string, Intl.NumberFormat>();
function nf(t: string, digits?: number, extra?: "signed" | "usd"): Intl.NumberFormat {
  const key = `${t}:${digits ?? ""}:${extra ?? ""}`;
  let f = numCache.get(key);
  if (!f) {
    const opts: Intl.NumberFormatOptions = digits === undefined
      ? {}
      : { minimumFractionDigits: digits, maximumFractionDigits: digits };
    if (extra === "signed") opts.signDisplay = "exceptZero";
    if (extra === "usd") { opts.style = "currency"; opts.currency = "USD"; }
    f = new Intl.NumberFormat(t, opts);
    numCache.set(key, f);
  }
  return f;
}

const dateCache = new Map<string, Intl.DateTimeFormat>();
function df(t: string, key: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const k = `${t}:${key}`;
  let f = dateCache.get(k);
  if (!f) { f = new Intl.DateTimeFormat(t, opts); dateCache.set(k, f); }
  return f;
}

export function num(v: number, locale: Locale, digits = 2): string {
  return nf(tag(locale), digits).format(v);
}

/** Always signed — the sign is part of the non-color encoding of direction. */
export function signed(v: number, locale: Locale, digits = 2): string {
  return nf(tag(locale), digits, "signed").format(v);
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
  return nf(tag(locale)).format(v);
}

/**
 * VND in full. Gold is quoted per lượng in raw dong (145_100_000), which is
 * unreadable at full width, so anything ≥ 1 triệu is abbreviated.
 */
export function vnd(v: number, locale: Locale): string {
  const vi = locale === "vi";
  if (v >= 1e6) return `${num(v / 1e6, locale, 2)} ${vi ? "triệu" : "M ₫"}`;
  return `${nf(tag(locale)).format(v)} ${vi ? "đ" : "₫"}`;
}

export function usd(v: number, locale: Locale): string {
  const digits = v >= 1000 ? 0 : v >= 1 ? 2 : 6;
  return nf(tag(locale), digits, "usd").format(v);
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
