import Link from "next/link";
import { num, pct } from "@/lib/format";
import { PATHS } from "@/lib/i18n";
import type { Locale, Quote } from "@/lib/types";
import { squarify } from "@/lib/treemap";

/**
 * Market heatmap — a squarified treemap of the board.
 *
 * Area encodes traded value (size = how much money moved), colour encodes the
 * session change. Colour here is DIVERGING, not categorical: two opposed hues
 * with a neutral grey midpoint, equal steps per arm, exactly as the palette
 * method requires. A rainbow or a single-hue ramp would both be wrong — the
 * data has a meaningful zero.
 *
 * Direction is never colour-alone: every tile prints its signed percentage.
 */

/** Equal-step arms either side of a neutral midpoint. */
const UP = ["var(--up-1)", "var(--up-2)", "var(--up-3)", "var(--up-4)"];
const DOWN = ["var(--down-1)", "var(--down-2)", "var(--down-3)", "var(--down-4)"];
const NEUTRAL = "var(--heat-zero)";

function bucket(changePct: number): { bg: string; strong: boolean } {
  const a = Math.abs(changePct);
  if (a < 0.05) return { bg: NEUTRAL, strong: false };
  const i = a < 0.5 ? 0 : a < 1.5 ? 1 : a < 3 ? 2 : 3;
  return { bg: changePct > 0 ? UP[i] : DOWN[i], strong: i >= 2 };
}

interface Tile { q: Quote; weight: number }

export function Heatmap({
  quotes,
  locale,
  height = 340,
  max = 30,
}: {
  quotes: Quote[];
  locale: Locale;
  height?: number;
  max?: number;
}) {
  // Weight by traded value: price × volume. Volume alone over-weights penny
  // stocks, and equal tiles would throw away the "how much money moved" signal.
  const items: Tile[] = quotes
    .map((q) => ({ q, weight: Math.max((q.volume ?? 0) * q.price, 1) }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, max);

  if (!items.length) return null;
  // Percentage-space layout: static HTML, no client measurement pass, reflows
  // with the container. Geometry is covered by src/lib/treemap.test.ts.
  const boxes = squarify(items.map((t) => ({ item: t, weight: t.weight })), 0, 0, 100, 100);

  return (
    <div className="card overflow-hidden p-2.5">
      <div className="relative w-full" style={{ height }}>
        {boxes.map(({ item: t, x, y, w, h }) => {
          const { bg, strong } = bucket(t.q.changePct);
          // Three legibility tiers. The previous single 7%-height cut left the
          // smallest tiles as unlabelled colour blocks — a tile you cannot
          // identify carries no information, so the symbol survives as long as
          // it physically fits and only the percentage drops first.
          const showPct = w > 6 && h > 9;
          const small = h < 6;
          const tiny = w < 2.4 || h < 3;
          return (
            <Link
              key={t.q.symbol}
              href={`/${locale}/${PATHS.terminal[locale]}/${t.q.symbol}`}
              title={`${t.q.symbol} ${num(t.q.price, locale, 2)} ${pct(t.q.changePct, locale)}`}
              className="absolute flex flex-col items-center justify-center overflow-hidden rounded-lg p-0.5 text-center leading-none outline-offset-[-2px] transition-opacity hover:opacity-85"
              style={{
                left: `calc(${x}% + 2px)`, top: `calc(${y}% + 2px)`,
                width: `calc(${w}% - 4px)`, height: `calc(${h}% - 4px)`,
                background: bg,
                color: strong ? "#fff" : "var(--ink)",
              }}
            >
              {!tiny && (
                <span className={`truncate font-mono font-semibold tracking-tight ${small ? "text-[10px]" : "text-[12px]"}`}>
                  {t.q.symbol}
                </span>
              )}
              {showPct && (
                <span className="tnum mt-1 font-mono text-[10px] opacity-90">{pct(t.q.changePct, locale)}</span>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

/** Scale legend — a diverging scale must always ship one. */
export function HeatmapLegend({ labels }: { labels: { down: string; flat: string; up: string } }) {
  return (
    <div className="mt-3 flex items-center gap-3 font-mono text-[11px] text-muted">
      <span>{labels.down}</span>
      <div className="flex h-2.5 flex-1 overflow-hidden rounded-lg" aria-hidden="true">
        {[...DOWN].reverse().map((c) => <div key={c} className="flex-1" style={{ background: c }} />)}
        <div className="flex-1" style={{ background: NEUTRAL }} />
        {UP.map((c) => <div key={c} className="flex-1" style={{ background: c }} />)}
      </div>
      <span>{labels.up}</span>
    </div>
  );
}
