"use client";

import { useEffect } from "react";
import { track } from "@/lib/analytics/posthog";
import type { Tier } from "@/lib/types";

/**
 * Fires `chart_viewed` — the denominator of the north-star metric (D7 return to
 * the chart). Renders nothing.
 *
 * `TerminalView` is a server component, so the event needs a client seam; the
 * props come from the server so `tier` is the verified one rather than a guess.
 *
 * `source` is read from `?src=`, which is how a click from an alert email or the
 * daily brief identifies itself. Without it every return looks like organic
 * navigation and the retention loops we are about to build are unmeasurable.
 */
export function ChartViewed({
  symbol,
  tf,
  intraday,
  layout,
  tier,
  hasCmp,
  hasFr,
}: {
  symbol: string;
  tf: string;
  intraday: boolean;
  layout: number;
  tier: Tier;
  hasCmp: boolean;
  hasFr: boolean;
}) {
  useEffect(() => {
    let source = "nav";
    try {
      source = new URLSearchParams(window.location.search).get("src") || "nav";
    } catch {
      /* a malformed query string must not cost the reader a chart */
    }
    track("chart_viewed", {
      symbol, tf, intraday, layout, tier, source,
      has_cmp: hasCmp, has_fr: hasFr,
    });
  }, [symbol, tf, intraday, layout, tier, hasCmp, hasFr]);
  return null;
}
