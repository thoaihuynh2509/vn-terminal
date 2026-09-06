/**
 * PostHog product analytics — SDK-free.
 *
 * The whole app avoids vendor SDKs (own mailer, own session crypto); analytics
 * is the same: PostHog's capture endpoint is one HTTP POST, so we send events
 * directly. No dependency, no 50KB bundle, and it FAILS CLOSED — with no key it
 * is a silent no-op, so a market page never waits on or breaks over telemetry.
 *
 * Only the payload builder is exported for tests; the browser bits (localStorage
 * id, sendBeacon) guard for SSR and for storage that throws.
 */

const KEY = "ph_distinct_id";

export interface PosthogConfig {
  apiKey: string;
  host: string;
}

/** Public env only — analytics runs in the browser. Null → disabled (no-op). */
export function posthogConfig(): PosthogConfig | null {
  const apiKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!apiKey) return null;
  return { apiKey, host: process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com" };
}

/** The exact JSON PostHog's capture endpoint accepts. Pure, so it is testable. */
export function captureBody(
  apiKey: string,
  event: string,
  distinctId: string,
  properties: Record<string, unknown>,
  nowMs: number,
): Record<string, unknown> {
  return {
    api_key: apiKey,
    event,
    distinct_id: distinctId,
    properties: { ...properties, $lib: "vnt-web" },
    timestamp: new Date(nowMs).toISOString(),
  };
}

/** A stable anonymous id per browser. Falls back to a per-call id if storage is blocked. */
function distinctId(): string {
  try {
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return "anon";
  }
}

function send(cfg: PosthogConfig, body: Record<string, unknown>): void {
  const url = `${cfg.host}/i/v0/e/`;
  const payload = JSON.stringify(body);
  try {
    // sendBeacon survives the pagehide of a navigation (e.g. checkout redirect);
    // fetch+keepalive is the fallback where beacon is unavailable.
    if (typeof navigator !== "undefined" && navigator.sendBeacon) {
      navigator.sendBeacon(url, new Blob([payload], { type: "application/json" }));
    } else {
      void fetch(url, { method: "POST", body: payload, headers: { "Content-Type": "application/json" }, keepalive: true });
    }
  } catch {
    /* telemetry must never surface to the reader */
  }
}

/** Fire an event. No-op on the server or when unconfigured. */
export function track(event: string, properties: Record<string, unknown> = {}): void {
  if (typeof window === "undefined") return;
  const cfg = posthogConfig();
  if (!cfg) return;
  send(cfg, captureBody(cfg.apiKey, event, distinctId(), properties, Date.now()));
}

/** Attach person properties (e.g. tier) to the current anonymous id. */
export function identify(properties: Record<string, unknown>): void {
  if (typeof window === "undefined") return;
  const cfg = posthogConfig();
  if (!cfg) return;
  send(cfg, captureBody(cfg.apiKey, "$identify", distinctId(), { $set: properties }, Date.now()));
}
