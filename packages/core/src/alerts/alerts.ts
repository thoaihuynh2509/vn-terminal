/**
 * Price alerts.
 *
 * Pure model + evaluation so the trigger logic is unit tested; storage and
 * delivery are the caller's problem.
 *
 * SCOPE, stated plainly because it matters to a user: on the free tier these are
 * evaluated in the browser against data the page has loaded, so they fire while
 * the page is open and not otherwise. On a tier with `alerts:email` the same
 * alerts are stored server-side and the nightly job evaluates them after the
 * close — which is why `evaluate()` is pure: the identical rule runs in both
 * places, and the two can never disagree about what fired.
 */
export type AlertCondition = "above" | "below" | "cross_up" | "cross_down";

/**
 * What the threshold is measured against.
 *
 * All three share one storage shape and one firing rule — only the observed
 * value differs, so `price` is simply "the threshold", whatever it is a
 * threshold ON. A percent alert resolves to a price the moment it is created,
 * which is what a reader means by "tell me at +5%": the level is fixed then, not
 * recomputed as the market moves under it.
 */
export type AlertKind = "price" | "pct" | "indicator";

/** Indicators where a FIXED level is a meaningful thing to watch for. */
export const ALERT_INDICATORS = ["rsi"] as const;
export type AlertIndicator = (typeof ALERT_INDICATORS)[number];

export interface PriceAlert {
  id: string;
  symbol: string;
  condition: AlertCondition;
  /** The threshold: a price, a computed target, or an indicator level. */
  price: number;
  createdAt: number;
  /** Set once the condition has been met, so it fires once rather than every tick. */
  triggeredAt?: number;
  /** Absent means "price" — rows stored before the other kinds existed. */
  kind?: AlertKind;
  /** pct only: what the reader asked for, and the price it was measured from. */
  pct?: number;
  basePrice?: number;
  /** indicator only. */
  indicator?: AlertIndicator;
  period?: number;
}

export function alertKind(a: PriceAlert): AlertKind {
  return a.kind ?? "price";
}

/** The fixed level a "+5% from here" alert becomes. */
export function targetFromPct(basePrice: number, pct: number): number {
  return basePrice * (1 + pct / 100);
}

/** Identifies which computed series an indicator alert needs. */
export function indicatorKey(a: PriceAlert): string {
  return `${a.indicator ?? "rsi"}${a.period ?? 14}`;
}

/** One observation of whatever an alert watches. */
export interface AlertObservation {
  current: number;
  previous?: number;
}

/**
 * What this alert should be tested against: the close for price and percent
 * alerts, the indicator's own value for an indicator alert. `null` means the
 * input needed is not available, and the alert is simply not evaluated this
 * round rather than being tested against the wrong number.
 */
export function observationFor(
  a: PriceAlert,
  price: AlertObservation,
  indicators?: Record<string, AlertObservation>,
): AlertObservation | null {
  if (alertKind(a) !== "indicator") return price;
  return indicators?.[indicatorKey(a)] ?? null;
}

export function newAlertId(): string {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * Does this alert fire?
 *
 * `above`/`below` are level tests — true whenever price is past the threshold.
 * `cross_up`/`cross_down` require the threshold to actually be crossed between
 * two observations, which is what most people mean and is far less noisy: a
 * level alert on a price already past it fires immediately and forever.
 */
export function shouldFire(alert: PriceAlert, current: number, previous?: number): boolean {
  if (alert.triggeredAt) return false; // already fired; one shot
  switch (alert.condition) {
    case "above": return current >= alert.price;
    case "below": return current <= alert.price;
    case "cross_up":
      return previous !== undefined && previous < alert.price && current >= alert.price;
    case "cross_down":
      return previous !== undefined && previous > alert.price && current <= alert.price;
  }
}

export interface Evaluation {
  alerts: PriceAlert[];
  fired: PriceAlert[];
}

/**
 * Marks any newly-met alerts as triggered and reports which ones fired.
 *
 * `indicators` supplies the value for indicator alerts, keyed by
 * `indicatorKey`. Without it those alerts are skipped rather than tested
 * against the price, which would fire "RSI above 70" the moment the share cost
 * more than 70 dong.
 */
export function evaluate(
  alerts: PriceAlert[],
  symbol: string,
  current: number,
  previous?: number,
  now = Date.now(),
  indicators?: Record<string, AlertObservation>,
): Evaluation {
  const fired: PriceAlert[] = [];
  const next = alerts.map((a) => {
    if (a.symbol !== symbol.toUpperCase()) return a;
    const obs = observationFor(a, { current, previous }, indicators);
    if (!obs) return a;
    if (!shouldFire(a, obs.current, obs.previous)) return a;
    const t = { ...a, triggeredAt: now };
    fired.push(t);
    return t;
  });
  return { alerts: next, fired };
}

/** Re-arms a fired alert so it can trigger again. */
export function reset(alerts: PriceAlert[], id: string): PriceAlert[] {
  return alerts.map((a) => (a.id === id ? { ...a, triggeredAt: undefined } : a));
}

export function remove(alerts: PriceAlert[], id: string): PriceAlert[] {
  return alerts.filter((a) => a.id !== id);
}

/** Enforces the tier ceiling at the model layer, not just in the UI. */
export function add(alerts: PriceAlert[], alert: PriceAlert, max: number): PriceAlert[] {
  if (alerts.length >= max) return alerts;
  return [...alerts, alert];
}

export const STORAGE_KEY = "alerts";

const SYMBOL_RE = /^[A-Z0-9]{1,10}$/;

/**
 * Coerce untrusted input into alerts, dropping anything malformed.
 *
 * Shared by the browser (reader-owned localStorage, which an extension or an
 * older build can corrupt) and the API (a request body, which is hostile until
 * proven otherwise). One definition of "a valid alert" means the two can never
 * disagree about what is storable.
 */
export function sanitizeAlerts(v: unknown): PriceAlert[] {
  if (!Array.isArray(v)) return [];
  const out: PriceAlert[] = [];
  const seen = new Set<string>();
  for (const a of v) {
    if (!a || typeof a !== "object") continue;
    const { id, symbol, condition, price, createdAt, triggeredAt } = a as Record<string, unknown>;
    if (typeof id !== "string" || !id || id.length > 32 || seen.has(id)) continue;
    if (typeof symbol !== "string" || !SYMBOL_RE.test(symbol.toUpperCase())) continue;
    if (typeof condition !== "string" || !["above", "below", "cross_up", "cross_down"].includes(condition)) continue;
    // A non-positive or non-finite threshold can never be crossed meaningfully
    // and would sit in the list firing or never firing, with no way to tell.
    if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) continue;
    const { kind, pct, basePrice, indicator, period } = a as Record<string, unknown>;
    const k: AlertKind =
      kind === "pct" || kind === "indicator" || kind === "price" ? kind : "price";
    // An indicator alert naming an indicator we cannot compute is not storable:
    // it would sit in the list forever, never evaluated and never explained.
    if (k === "indicator" && !(ALERT_INDICATORS as readonly string[]).includes(String(indicator))) continue;

    seen.add(id);
    out.push({
      id,
      symbol: symbol.toUpperCase(),
      condition: condition as AlertCondition,
      price,
      createdAt: typeof createdAt === "number" && Number.isFinite(createdAt) ? createdAt : Date.now(),
      ...(typeof triggeredAt === "number" && Number.isFinite(triggeredAt) ? { triggeredAt } : {}),
      ...(k !== "price" ? { kind: k } : {}),
      ...(k === "pct" && typeof pct === "number" && Number.isFinite(pct) ? { pct } : {}),
      ...(k === "pct" && typeof basePrice === "number" && basePrice > 0 ? { basePrice } : {}),
      ...(k === "indicator" ? { indicator: indicator as AlertIndicator } : {}),
      ...(k === "indicator" && typeof period === "number" && period >= 2 && period <= 200
        ? { period: Math.round(period) }
        : {}),
    });
  }
  return out;
}

/** Tolerant parse: a corrupt entry must not lose every other alert. */
export function parseAlerts(raw: string | null): PriceAlert[] {
  if (!raw) return [];
  try {
    return sanitizeAlerts(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function serializeAlerts(alerts: PriceAlert[]): string {
  return JSON.stringify(alerts);
}
