"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Locale } from "@/lib/types";

/**
 * "As of HH:MM:SS" plus a quiet auto-refresh, so the page feels live the way a
 * terminal should and a static news site does not.
 *
 * The clock ticks locally every second; every `refreshMs` it calls
 * router.refresh(), which re-runs the server component with fresh feed data —
 * no bespoke client fetching, the whole page updates through one seam. A pulsing
 * dot signals "live" without motion that distracts.
 */
export function LiveStamp({ locale, refreshMs = 30_000 }: { locale: Locale; refreshMs?: number }) {
  const router = useRouter();
  const [now, setNow] = useState<Date | null>(null); // null until mounted, so SSR and first client render match

  useEffect(() => {
    // Deferred, not synchronous in the effect body: the first paint keeps the
    // SSR placeholder, then the clock starts on the next frame (no hydration gap).
    const first = requestAnimationFrame(() => setNow(new Date()));
    const tick = setInterval(() => setNow(new Date()), 1000);
    const refresh = setInterval(() => router.refresh(), refreshMs);
    return () => {
      cancelAnimationFrame(first);
      clearInterval(tick);
      clearInterval(refresh);
    };
  }, [router, refreshMs]);

  const label = locale === "vi" ? "Cập nhật lúc" : "Updated";
  const time = now
    ? new Intl.DateTimeFormat(locale === "vi" ? "vi-VN" : "en-US", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        timeZone: "Asia/Ho_Chi_Minh",
      }).format(now)
    : "—";

  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] text-muted" aria-live="off">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-up" aria-hidden="true" />
      <span className="tnum">{label} {time}</span>
    </span>
  );
}
