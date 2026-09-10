import Link from "next/link";
import { arrow, dirOf, num, pct, usd } from "@/lib/format";
import { PATHS } from "@/lib/i18n";
import { LiveStamp } from "./LiveStamp";
import type { GoldSnapshot, Locale, Quote } from "@/lib/types";

/**
 * The market strip — the top edge of every page.
 *
 * One dense mono row of live quotes spanning every asset class the product
 * covers: VN indices, domestic gold and world gold. It sits ABOVE the header
 * on near-black chrome so the market, not the navigation, is the first thing
 * on the page.
 *
 * --up / --down are too dark to read on chrome, so the deltas here use the
 * --chrome-up / --chrome-down pair. The ▲/▼ glyph and the sign still carry
 * direction without colour, exactly as `Delta` does on light surfaces.
 *
 * It scrolls horizontally rather than wrapping; a ticker that reflows onto
 * three rows on a phone stops reading as a ticker.
 */
export function Ticker({
  indices,
  gold,
  locale,
}: {
  indices: Quote[];
  gold: GoldSnapshot | null;
  locale: Locale;
}) {
  const items: { label: string; value: string; change: number; pct?: number; href: string }[] = [];

  for (const i of indices) {
    items.push({
      label: i.symbol,
      value: num(i.price, locale, 2),
      change: i.change,
      pct: i.changePct,
      href: `/${locale}/${PATHS.stocks[locale]}`,
    });
  }

  const sjc = gold?.rows.find((r) => r.code === "SJL1L10") ?? gold?.rows[0];
  if (sjc) {
    items.push({
      label: "SJC",
      value: `${num(sjc.sell / 1e6, locale, 2)}tr`,
      change: sjc.changeSell || sjc.changeBuy,
      href: `/${locale}/${PATHS.gold[locale]}`,
    });
  }
  if (gold?.world) {
    items.push({
      label: "XAU/USD",
      value: usd(gold.world.buy, locale),
      change: gold.world.changeBuy,
      href: `/${locale}/${PATHS.gold[locale]}`,
    });
  }
  if (!items.length) return null;

  return (
    <div className="bg-chrome text-chrome-ink">
      <div className="mx-auto flex max-w-[1400px] items-center gap-6 px-4 sm:px-6 lg:px-8">
        <div className="relative min-w-0 flex-1 overflow-x-auto">
          <ul className="flex items-center gap-5 whitespace-nowrap py-2.5 pr-4">
            {items.map((it) => {
              const dir = dirOf(it.pct ?? it.change, 2);
              const tone =
                dir === "up" ? "text-chrome-up" : dir === "down" ? "text-chrome-down" : "text-chrome-ink-2";
              return (
                <li key={it.label} className="shrink-0">
                  <Link href={it.href} className="tnum flex items-baseline gap-1.5 font-mono text-[12px] hover:opacity-80">
                    <span className="text-chrome-ink-2">{it.label}</span>
                    <span className="font-medium">{it.value}</span>
                    <span className={tone}>
                      <span aria-hidden="true">{arrow(dir)}</span>
                      <span className="sr-only">{dir === "up" ? "tăng" : dir === "down" ? "giảm" : "không đổi"}</span>
                      {it.pct !== undefined ? ` ${pct(it.pct, locale)}` : ` ${num(Math.abs(it.change), locale, 2)}`}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
        <div className="hidden shrink-0 py-2.5 lg:block">
          <LiveStamp locale={locale} tone="chrome" sessionAware refreshMs={60_000} />
        </div>
      </div>
    </div>
  );
}
