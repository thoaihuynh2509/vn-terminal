"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { isSessionOpen } from "@/lib/chart/session";
import type { Locale } from "@/lib/types";

/**
 * "As of HH:MM:SS" plus a quiet auto-refresh, so the page feels live the way a
 * terminal should and a static news site does not.
 *
 * The clock ticks locally every second; every `refreshMs` it calls
 * router.refresh(), which re-runs the server component with fresh feed data —
 * no bespoke client fetching, the whole page updates through one seam. A pulsing
 * dot signals "live" without motion that distracts.
 *
 * `sessionAware` ties both the refresh and the dot to HOSE trading hours. Off
 * session the price cannot change, so refreshing spends the reader's battery and
 * our upstream quota to re-fetch an identical number — and a pulsing "live" dot
 * over a frozen close is simply untrue. The board pages leave it off because
 * their gold rows do keep moving after the equity close.
 */
export function LiveStamp({
  locale,
  refreshMs = 30_000,
  sessionAware = false,
  tone = "default",
}: {
  locale: Locale;
  refreshMs?: number;
  sessionAware?: boolean;
  /** `chrome` is the near-black ticker bar, where --muted is unreadable. */
  tone?: "default" | "chrome";
}) {
  const router = useRouter();
  const [now, setNow] = useState<Date | null>(null); // null until mounted, so SSR and first client render match

  useEffect(() => {
    // Deferred, not synchronous in the effect body: the first paint keeps the
    // SSR placeholder, then the clock starts on the next frame (no hydration gap).
    const first = requestAnimationFrame(() => setNow(new Date()));
    const tick = setInterval(() => setNow(new Date()), 1000);
    const refresh = setInterval(() => {
      if (sessionAware && !isSessionOpen(new Date())) return;
      router.refresh();
    }, refreshMs);
    return () => {
      cancelAnimationFrame(first);
      clearInterval(tick);
      clearInterval(refresh);
    };
  }, [router, refreshMs, sessionAware]);

  // Derived from `now`, never from a fresh clock read during render: on the
  // server and on the first client render `now` is null, so both sides agree and
  // hydration cannot mismatch. It settles on the next frame.
  const live = now === null || !sessionAware || isSessionOpen(now);
  const label = live
    ? locale === "vi" ? "Cập nhật lúc" : "Updated"
    : locale === "vi" ? "Đóng cửa · cập nhật" : "Closed · updated";
  const time = now
    ? new Intl.DateTimeFormat(locale === "vi" ? "vi-VN" : "en-US", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        timeZone: "Asia/Ho_Chi_Minh",
      }).format(now)
    : "—";

  const onChrome = tone === "chrome";
  return (
    <span
      className={`inline-flex items-center gap-2 whitespace-nowrap text-[12px] ${onChrome ? "text-chrome-ink-2" : "text-muted"}`}
      aria-live="off"
    >
      <span
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${
          live ? `pulse-dot ${onChrome ? "bg-chrome-up" : "bg-up"}` : onChrome ? "bg-chrome-ink-2" : "bg-muted"
        }`}
        aria-hidden="true"
      />
      <span className="tnum font-mono">{label} {time}</span>
    </span>
  );
}
