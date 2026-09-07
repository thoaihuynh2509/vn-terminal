/**
 * Price alerts.
 *
 * Pure model + evaluation so the trigger logic is unit tested; storage and
 * delivery are the caller's problem.
 *
 * SCOPE, stated plainly because it matters to a user: these alerts are evaluated
 * in the browser against data the page has loaded. They fire while the page is
 * open and not otherwise. Real background delivery needs a server-side evaluator
 * and a push/email channel — `evaluate()` is deliberately pure so that the same
 * function can run on a server worker when that exists, with no rewrite.
 */
export type AlertCondition = "above" | "below" | "cross_up" | "cross_down";

export interface PriceAlert {
  id: string;
  symbol: string;
  condition: AlertCondition;
  price: number;
  createdAt: number;
  /** Set once the condition has been met, so it fires once rather than every tick. */
  triggeredAt?: number;
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

/** Marks any newly-met alerts as triggered and reports which ones fired. */
export function evaluate(
  alerts: PriceAlert[],
  symbol: string,
  current: number,
  previous?: number,
  now = Date.now(),
): Evaluation {
  const fired: PriceAlert[] = [];
  const next = alerts.map((a) => {
    if (a.symbol !== symbol.toUpperCase()) return a;
    if (!shouldFire(a, current, previous)) return a;
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
    seen.add(id);
    out.push({
      id,
      symbol: symbol.toUpperCase(),
      condition: condition as AlertCondition,
      price,
      createdAt: typeof createdAt === "number" && Number.isFinite(createdAt) ? createdAt : Date.now(),
      ...(typeof triggeredAt === "number" && Number.isFinite(triggeredAt) ? { triggeredAt } : {}),
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
