/**
 * PostHog product analytics — SDK-free.
 *
 * The whole app avoids vendor SDKs (own mailer, own session crypto); analytics
 * is the same: PostHog's capture endpoint is one HTTP POST, so we send events
 * directly. No dependency, no 50KB bundle, and it FAILS CLOSED — with no key it
 * is a silent no-op, so a market page never waits on or breaks over telemetry.
 *
 * Only the payload builders are exported for tests; the browser bits
 * (localStorage ids, sendBeacon) guard for SSR and for storage that throws.
 */

const KEY = "ph_distinct_id";

/**
 * The signed-in reader's analytics id, kept BESIDE the browser id rather than
 * overwriting it: signing out then restores the anonymous identity this browser
 * arrived with, instead of leaving a shared machine reporting as the account
 * that just left.
 */
const PERSON_KEY = "ph_person_id";

export interface PosthogConfig {
  apiKey: string;
  host: string;
}

/** Public env only — analytics runs in the browser. Null → disabled (no-op). */
export function posthogConfig(): PosthogConfig | null {
  const apiKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!apiKey) return null;
  // Normalised here as well as in `ingestUrl`, whose docstring carries the
  // rationale, so a config passed in directly is covered either way. Same
  // trim-and-strip idiom as `siteUrl()`.
  const host = (process.env.NEXT_PUBLIC_POSTHOG_HOST || "").trim().replace(/\/+$/, "");
  return { apiKey, host: host || "https://us.i.posthog.com" };
}

/**
 * The exact JSON PostHog's capture endpoint accepts. Pure, so it is testable.
 * `lib` names the sender: the server rail tags its own events so a purchase
 * confirmed by the owner is not counted as something the browser did.
 */
export function captureBody(
  apiKey: string,
  event: string,
  distinctId: string,
  properties: Record<string, unknown>,
  nowMs: number,
  lib = "vnt-web",
): Record<string, unknown> {
  return {
    api_key: apiKey,
    event,
    distinct_id: distinctId,
    properties: { ...properties, $lib: lib },
    timestamp: new Date(nowMs).toISOString(),
  };
}

/**
 * `$identify`, which merges an anonymous browser id into a known person so the
 * sessions before sign-in stay attached to the account they became.
 *
 * A null `anonId` is the no-merge case — properties attached to the id already
 * in hand — because PostHog rejects an `$identify` whose two ids are the same.
 */
export function identifyBody(
  apiKey: string,
  distinctId: string,
  anonId: string | null,
  properties: Record<string, unknown>,
  nowMs: number,
): Record<string, unknown> {
  return captureBody(
    apiKey,
    "$identify",
    distinctId,
    { ...(anonId ? { $anon_distinct_id: anonId } : {}), $set: properties },
    nowMs,
  );
}

/** A stable anonymous id per browser. Falls back to a per-call id if storage is blocked. */
function anonId(): string {
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

/** The person this browser has been identified as, if any. */
function adoptedPerson(): string | null {
  try {
    return localStorage.getItem(PERSON_KEY);
  } catch {
    return null;
  }
}

/** Who an event is attributed to: the identified person once there is one. */
function distinctId(): string {
  return adoptedPerson() ?? anonId();
}

/**
 * The capture endpoint for a host, tolerant of a trailing slash.
 *
 * Both senders (the browser beacon below and `captureServer`) build this URL,
 * and a host typed with a trailing slash — the most common way a URL env var is
 * written — would address `//i/v0/e/`, a different path. The failure is silent
 * end to end, because a failed capture is deliberately swallowed so telemetry
 * can never break a payment: every purchase event would vanish and revenue
 * would read zero, which looks exactly like nobody buying. Normalising here
 * rather than only in `posthogConfig` also covers a config passed in directly.
 */
export function ingestUrl(host: string): string {
  return `${host.trim().replace(/\/+$/, "")}/i/v0/e/`;
}

function send(cfg: PosthogConfig, body: Record<string, unknown>): void {
  const url = ingestUrl(cfg.host);
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

/**
 * Attach person properties (e.g. tier) to this browser's own id.
 *
 * Also RELEASES a person adopted by `identifyAs`, because this is the signed-out
 * path: on a shared machine the next reader's events must not keep landing on
 * the account that just signed out.
 */
export function identify(properties: Record<string, unknown>): void {
  if (typeof window === "undefined") return;
  const cfg = posthogConfig();
  if (!cfg) return;
  try {
    localStorage.removeItem(PERSON_KEY);
  } catch {
    /* storage blocked: nothing was ever adopted to release */
  }
  send(cfg, identifyBody(cfg.apiKey, anonId(), null, properties, Date.now()));
}

/**
 * Adopt a known person for this browser, merging what it did anonymously first.
 *
 * The server rail can only attribute a purchase to `personId(email)` — payment
 * is a static QR the owner confirms by hand, hours later, with the buyer's
 * browser long gone — so the browser has to answer to that same id or
 * `checkout_started → purchase_completed` is two strangers and the funnel reads
 * zero conversions against revenue with no events before it.
 */
export function identifyAs(person: string, properties: Record<string, unknown> = {}): void {
  if (typeof window === "undefined") return;
  const cfg = posthogConfig();
  if (!cfg) return;
  // Only the first call merges. A merge is not undoable, and re-sending one
  // PostHog has already applied is noise on every page load of a session.
  const anon = adoptedPerson() === person ? null : anonId();
  send(cfg, identifyBody(cfg.apiKey, person, anon, properties, Date.now()));
  try {
    localStorage.setItem(PERSON_KEY, person);
  } catch {
    /* storage blocked: the merge landed, later events stay anonymous */
  }
}
