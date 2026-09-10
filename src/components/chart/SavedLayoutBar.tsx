"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useStored } from "@/lib/browser-store";
import { LAYOUTS_KEY, layoutQuery, parseLayouts } from "@/lib/chart/layouts";
import { PATHS, type Dict } from "@/lib/i18n";
import type { Locale } from "@/lib/types";

/**
 * Saved setups, one click from the toolbar.
 *
 * P1-6 put layouts in the rail, which is the right home for managing them but
 * the wrong one for USING them: switching between "my bank screen" and "my
 * steel screen" is a thing a reader does constantly, and it should not cost
 * opening a panel first.
 *
 * Renders nothing when there is nothing saved, so a reader who has never used
 * the feature never sees a control for it.
 */
export function SavedLayoutBar({
  locale, dict, current,
}: {
  locale: Locale;
  dict: Dict;
  /** The symbol on screen, so the active setup can be marked. */
  current: string;
}) {
  const raw = useStored(LAYOUTS_KEY);
  const layouts = useMemo(() => parseLayouts(raw).slice(0, 4), [raw]);
  if (!layouts.length) return null;

  return (
    <div role="group" aria-label={dict.chart.tabLayouts} className="flex shrink-0 items-center gap-1">
      {layouts.map((l) => {
        const q = layoutQuery(l);
        const active = l.symbol === current.toUpperCase();
        return (
          <Link
            key={l.name}
            href={`/${locale}/${PATHS.terminal[locale]}/${l.symbol}${q ? `?${q}` : ""}`}
            aria-current={active ? "true" : undefined}
            title={`${l.name} · ${[l.symbol, ...l.extra].join(" · ")}`}
            className={`max-w-[9rem] truncate rounded-lg border border-line px-2 py-1 text-[12px] font-medium ${
              active ? "bg-page text-ink" : "text-ink-2 hover:text-ink"
            }`}
          >
            {l.name}
          </Link>
        );
      })}
    </div>
  );
}
