import { num } from "@/lib/format";
import { dirOf } from "@/lib/format";
import type { Locale, Quote } from "@/lib/types";
import { Delta } from "./Delta";
import { Sparkline } from "./Sparkline";

/**
 * Index tiles.
 *
 * The value is the story, so it gets the largest type on the page after a
 * headline; the 20-session sparkline sits beside it as shape-only context with
 * no axis — the numbers underneath carry the actual values.
 */
export function IndexStrip({
  indices,
  locale,
  sparks = {},
}: {
  indices: Quote[];
  locale: Locale;
  sparks?: Record<string, number[]>;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {indices.map((i) => {
        const spark = sparks[i.symbol] ?? i.spark ?? [];
        return (
          <div key={i.symbol} className="card card-hover p-3.5">
            <div className="text-[11px] font-bold uppercase tracking-wider text-muted">{i.symbol}</div>
            <div className="mt-1.5 flex items-end justify-between gap-2">
              <div className="tnum text-[24px] font-semibold leading-none tracking-tight">
                {num(i.price, locale, 2)}
              </div>
              {spark.length > 2 && (
                <div className="shrink-0 pb-0.5">
                  <Sparkline points={spark} dir={dirOf(i.changePct, 2)} width={64} height={22} />
                </div>
              )}
            </div>
            <div className="mt-2 text-[12px]">
              <Delta change={i.change} changePct={i.changePct} locale={locale} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
