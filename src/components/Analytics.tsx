"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { track } from "@/lib/analytics/posthog";

/**
 * Fires a `$pageview` on every route change — the top of the funnel. Renders
 * nothing; mounted once in the layout. A no-op when PostHog is unconfigured, so
 * it is safe to ship before the key exists.
 */
export function Analytics() {
  const pathname = usePathname();
  useEffect(() => {
    track("$pageview", { $current_url: window.location.href, path: pathname });
  }, [pathname]);
  return null;
}
