"use client";

import { useEffect } from "react";
import { identify } from "@/lib/analytics/posthog";
import type { Locale, Tier } from "@/lib/types";

/**
 * Attaches `tier` to the PostHog person record.
 *
 * `identify()` shipped with the analytics module but was never called, so every
 * funnel was uncuttable by tier — we could see that someone hit a limit and
 * never which plan they were on, which is exactly the question the pricing
 * decisions turn on. Renders nothing; a no-op when PostHog is unconfigured.
 *
 * The tier is resolved on the server and passed in: a client-read tier would be
 * a claim, not a fact.
 */
export function Identify({
  tier,
  locale,
  signedIn,
  expiresAt = null,
}: {
  tier: Tier;
  locale: Locale;
  signedIn: boolean;
  /** Unix seconds when a paid tier lapses, when there is one. */
  expiresAt?: number | null;
}) {
  useEffect(() => {
    identify({
      tier,
      locale,
      signed_in: signedIn,
      ...(expiresAt ? { tier_expires_at: new Date(expiresAt * 1000).toISOString() } : {}),
    });
  }, [tier, locale, signedIn, expiresAt]);
  return null;
}
