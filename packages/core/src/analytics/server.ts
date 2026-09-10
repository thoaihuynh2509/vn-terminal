/**
 * Server-side capture — the conversions the browser cannot see.
 *
 * Payment here is a static bank/MoMo QR with no gateway: the owner confirms an
 * order by hand, hours later, with the buyer's browser long gone. So a purchase
 * can only be reported from the server, at the seam that grants the tier.
 *
 * `node:crypto` is imported deliberately rather than WebCrypto: this module must
 * never be pulled into a client bundle, and an explicit node import fails loudly
 * if it ever is, instead of shipping a hashing salt to the browser.
 */
import { createHash } from "node:crypto";
import { captureBody, posthogConfig, type PosthogConfig, ingestUrl } from "./posthog.ts";

/**
 * Fixed, so one address always maps to the same person across deploys, but
 * configurable because the fallback literal is readable in the source: with it
 * and a PostHog export, anyone can hash a known address and learn that a named
 * person subscribes and what they spent. Set ANALYTICS_PERSON_SALT (server-only,
 * never NEXT_PUBLIC_) to 32+ random bytes. Changing it re-anonymises everyone —
 * every person id changes and the history behind the old ones does not follow.
 */
const PERSON_SALT = process.env.ANALYTICS_PERSON_SALT || "vnt.person.v1";

/**
 * How long a capture may hold the request it is attached to.
 *
 * Two budgets, because the callers have nothing in common. A provider webhook
 * (MoMo/VNPay/SePay IPN, the owner's manual confirm) is a machine on its own
 * retry schedule that never notices the wait, and a conversion lost here is
 * never re-sent, so it waits. An interactive request is a person watching a
 * redirect or a button, where the same wait IS the cost of PostHog being
 * degraded — nothing about the sign-in depends on the event, so it gives up
 * sooner. Deployment region is not pinned (vercel.json sets no `regions`), so
 * treat these as budgets to tune, not as measurements.
 */
export const WEBHOOK_CAPTURE_MS = 1500;
export const INTERACTIVE_CAPTURE_MS = 600;

export interface ServerEvent {
  name: string;
  distinctId: string;
  properties: Record<string, unknown>;
}

export type ServerTransport = (
  url: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
) => Promise<void>;

export interface CaptureOptions {
  config?: PosthogConfig | null;
  transport?: ServerTransport;
  timeoutMs?: number;
  nowMs?: number;
}

/**
 * The analytics identity of an email address: a salted SHA-256, never the
 * address. The vendor gets an id it can count, not a mailing list.
 */
export function personId(email: string): string {
  return createHash("sha256").update(`${PERSON_SALT}:${email.trim().toLowerCase()}`).digest("hex");
}

const post: ServerTransport = async (url, body, signal) => {
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
};

/**
 * Send one event. Never throws and never rejects — a payment must not fail
 * because an analytics vendor is down — and never outlives `timeoutMs`, because
 * a wedged socket would otherwise hold the response open. Returns whether the
 * event actually went out.
 */
export async function captureServer(event: ServerEvent, opts: CaptureOptions = {}): Promise<boolean> {
  const cfg = opts.config === undefined ? posthogConfig() : opts.config;
  if (!cfg) return false; // unconfigured: a no-op, not a request to nowhere
  const transport = opts.transport ?? post;
  const signal = AbortSignal.timeout(opts.timeoutMs ?? WEBHOOK_CAPTURE_MS);
  const body = captureBody(cfg.apiKey, event.name, event.distinctId, event.properties, opts.nowMs ?? Date.now(), "vnt-server");
  try {
    // Raced against the signal as well as passed to it: a transport that ignores
    // the abort (or never settles at all) still gives the caller its response.
    await Promise.race([
      transport(ingestUrl(cfg.host), body, signal),
      new Promise<never>((_, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      }),
    ]);
    return true;
  } catch {
    return false;
  }
}
