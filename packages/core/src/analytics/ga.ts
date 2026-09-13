/**
 * Google Analytics 4, beside PostHog. The layout mounts the Google tag; this module decides whether
 * it runs and shapes what `track()` forwards. Fails closed: without a valid measurement id nothing
 * loads and nothing is sent.
 */

export type GaParams = Record<string, string | number | boolean>;
type Gtag = (command: "event", name: string, params: GaParams) => void;

declare global {
  interface Window {
    gtag?: Gtag;
  }
}

const ID = /^G-[A-Z0-9]+$/;
const NAME_MAX = 40;
const PARAMS_MAX = 25;
const VALUE_MAX = 100;

/** The measurement id when well formed, else null; the check is also what makes it safe to inline in a script. */
export function gaId(raw: string | undefined = process.env.NEXT_PUBLIC_GA_ID): string | null {
  const id = (raw ?? "").trim().toUpperCase();
  return ID.test(id) ? id : null;
}

// GA names: letters, digits and underscores, starting with a letter.
const clean = (s: string) => s.replace(/[^A-Za-z0-9_]/g, "_").replace(/^[^A-Za-z]+/, "").slice(0, NAME_MAX);

/** The GA event an app event becomes, or null for PostHog's own `$` events, page views included, which GA measures itself. */
export function gaPayload(event: string, props: Record<string, unknown>): { name: string; params: GaParams } | null {
  if (event.startsWith("$")) return null;
  const name = clean(event);
  if (!name) return null;
  const params: GaParams = {};
  let n = 0;
  for (const [k, v] of Object.entries(props)) {
    if (n >= PARAMS_MAX) break;
    const key = clean(k);
    if (!key) continue;
    if (typeof v === "string") params[key] = v.slice(0, VALUE_MAX);
    else if ((typeof v === "number" && Number.isFinite(v)) || typeof v === "boolean") params[key] = v;
    else continue;
    n++;
  }
  return { name, params };
}

/** Send an app event to GA when the Google tag is on the page. */
export function gaEvent(event: string, props: Record<string, unknown>): void {
  if (typeof window === "undefined" || typeof window.gtag !== "function") return;
  const p = gaPayload(event, props);
  if (!p) return;
  try {
    window.gtag("event", p.name, p.params);
  } catch {
    /* telemetry must never surface to the reader */
  }
}
