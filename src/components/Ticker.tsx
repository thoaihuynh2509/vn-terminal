import Link from "next/link";
import { arrow, dirClass, dirOf, num, pct, usd } from "@/lib/format";
import { PATHS } from "@/lib/i18n";
import type { Coin, GoldSnapshot, Locale, Quote } from "@/lib/types";

/**
 * The market strip under the header.
 *
 * The reference site's most recognisable element: one dense row of live
 * quotes spanning every asset class the publication covers. Here that is VN
 * indices, domestic and world gold, and the two largest coins — the whole
 * product in a single line.
 *
 * It scrolls horizontally rather than wrapping; a ticker that reflows onto three
 * rows on a phone stops reading as a ticker.
 */
export function Ticker({
  indices,
  gold,
  coins,
  locale,
}: {
  indices: Quote[];
  gold: GoldSnapshot | null;
  coins: Coin[];
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
  for (const sym of ["BTC", "ETH"]) {
    const c = coins.find((x) => x.symbol === sym);
    if (c) {
      items.push({
        label: sym,
        value: usd(c.price, locale),
        change: c.changePct24h,
        pct: c.changePct24h,
        href: `/${locale}/${PATHS.crypto[locale]}`,
      });
    }
  }

  if (!items.length) return null;

  return (
    <div className="overflow-hidden border-b border-line bg-surface">
      <div className="relative mx-auto max-w-[1400px] overflow-x-auto px-4">
        <ul className="flex items-center gap-5 whitespace-nowrap py-2 pr-6">
          {items.map((it) => {
            const dir = dirOf(it.pct ?? it.change, 2);
            return (
              <li key={it.label} className="shrink-0">
                <Link href={it.href} className="tnum flex items-baseline gap-1.5 text-[12px] hover:opacity-80">
                  <span className="font-semibold tracking-tight">{it.label}</span>
                  <span className="text-ink-2">{it.value}</span>
                  <span className={dirClass(dir)}>
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
    </div>
  );
}
