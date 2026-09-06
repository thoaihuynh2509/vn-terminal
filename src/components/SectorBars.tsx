import Link from "next/link";
import { Delta } from "./Delta";
import { PATHS, type Dict } from "@/lib/i18n";
import { SECTOR_LABEL, sectorStats } from "@/lib/sectors";
import type { Locale, Quote } from "@/lib/types";

/**
 * Sector rotation — where the money went today, by turnover-weighted change.
 *
 * This is the one read on the page that no free Vietnamese board publishes: it
 * answers "banks or property today?" without the reader summing thirty rows.
 * Bars are drawn from a shared zero so the two arms are directly comparable, and
 * every bar prints its signed number — the hue is never the only signal.
 */
export function SectorBars({ board, locale, dict }: { board: Quote[]; locale: Locale; dict: Dict }) {
  const stats = sectorStats(board);
  if (!stats.length) return null;
  // One scale for both arms, so a +0.4% bar cannot look longer than a -0.9% one.
  const span = Math.max(...stats.map((s) => Math.abs(s.weightedChangePct)), 0.1);

  return (
    <ul className="space-y-2">
      {stats.map((s) => {
        const up = s.weightedChangePct >= 0;
        const width = `${(Math.abs(s.weightedChangePct) / span) * 50}%`;
        return (
          <li key={s.key}>
            <div className="flex items-baseline justify-between gap-2">
              <Link href={`/${locale}/${PATHS.stocks[locale]}`} className="truncate text-[12px] text-ink-2 hover:text-accent">
                {SECTOR_LABEL[s.key][locale]}
                <span className="tnum ml-1.5 text-[11px] text-muted">
                  {s.advancing}/{s.declining} {dict.home.breadth}
                </span>
              </Link>
              <span className="tnum shrink-0 text-[12px]">
                <Delta change={s.weightedChangePct} changePct={s.weightedChangePct} locale={locale} showAbsolute={false} />
              </span>
            </div>
            {/* Bars grow out of a centre line: left is down, right is up. */}
            <div className="relative mt-1 h-1.5 rounded-full bg-surface-2" aria-hidden="true">
              <span
                className="absolute top-0 h-1.5 rounded-full"
                style={{ width, background: up ? "var(--up)" : "var(--down)", left: up ? "50%" : undefined, right: up ? undefined : "50%" }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
