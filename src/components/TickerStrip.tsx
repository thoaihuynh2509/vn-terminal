import { Ticker } from "./Ticker";
import { SkeletonBar } from "./ui";
import { getDict } from "@/lib/i18n";
import { getGold } from "@/lib/providers/gold";
import { getIndices } from "@/lib/providers/vnstock";
import type { Locale } from "@/lib/types";

/**
 * Server wrapper so the strip can live in the layout and appear on every page.
 * Both feeds share the app's TTL cache, so this costs one fetch per minute
 * across the whole site rather than one per page view.
 */
export async function TickerStrip({ locale }: { locale: Locale }) {
  const [i, g] = await Promise.allSettled([getIndices(), getGold()]);
  const indices = i.status === "fulfilled" ? i.value : [];
  const gold = g.status === "fulfilled" ? g.value : null;
  if (!indices.length && !gold) return null;
  return <Ticker indices={indices} gold={gold} locale={locale} />;
}

/**
 * The strip in the state it holds before the feeds answer.
 *
 * Same shell, same padding, same mono type as `Ticker`, so the page below does
 * not move when the real quotes swap in. The widths mirror the real cells — a
 * short symbol, a longer figure — rather than a uniform row of blocks.
 *
 * The strip is the layout's only runtime data read, and `loading.tsx` cannot
 * cover a layout: without this boundary the whole navigation blocks on these
 * two feeds. See the Next docs on layout/loading interaction.
 */
export function TickerStripFallback({ locale }: { locale: Locale }) {
  const dict = getDict(locale);
  return (
    <div className="bg-chrome text-chrome-ink">
      <div className="mx-auto flex max-w-[1400px] items-center gap-6 px-4 sm:px-6 lg:px-8">
        <div className="relative min-w-0 flex-1 overflow-x-auto">
          <ul
            role="status"
            aria-label={dict.common.loading}
            className="flex items-center gap-5 whitespace-nowrap py-2.5 pr-4"
          >
            {PENDING_CELLS.map(([label, value], i) => (
              <li key={i} className="shrink-0">
                <span className="flex items-baseline gap-1.5 font-mono text-[12px]">
                  <SkeletonBar ch={label} tone="chrome" />
                  <SkeletonBar ch={value} tone="chrome" />
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

/** [symbol width, figure width] per pending cell, in characters. */
const PENDING_CELLS: [number, number][] = [
  [7, 9], [3, 8], [5, 8], [3, 7], [7, 8],
];
