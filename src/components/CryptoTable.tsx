import Link from "next/link";
import type { Coin, Locale } from "@/lib/types";
import { compactUsd, dirOf, usd } from "@/lib/format";
import { PATHS, type Dict } from "@/lib/i18n";
import { Delta } from "./Delta";
import { Sparkline } from "./Sparkline";

export function CryptoTable({
  coins,
  locale,
  dict,
  limit,
}: {
  coins: Coin[];
  locale: Locale;
  dict: Dict;
  limit?: number;
}) {
  const rows = limit ? coins.slice(0, limit) : coins;

  return (
    <div className="card relative overflow-x-auto">
      <table className="data-table w-full min-w-[680px] text-[13px]">
        <caption className="sr-only">{dict.crypto.title}</caption>
        <thead className="border-b border-line bg-surface-2 text-[11px] uppercase tracking-wide text-muted">
          <tr>
            <th scope="col" className="w-8 px-2 py-2 text-right font-medium">{dict.crypto.rank}</th>
            <th scope="col" className="px-2 py-2 text-left font-medium">{dict.common.name}</th>
            <th scope="col" className="px-2 py-2 text-right font-medium">{dict.common.price}</th>
            <th scope="col" className="px-2 py-2 text-right font-medium">{dict.crypto.price24h}</th>
            <th scope="col" className="px-2 py-2 text-right font-medium">{dict.common.marketCap}</th>
            <th scope="col" className="px-2 py-2 text-right font-medium">{dict.crypto.sparkline}</th>
          </tr>
        </thead>
        <tbody className="tnum">
          {rows.map((c) => {
            const dir = dirOf(c.changePct24h);
            return (
              <tr key={c.id} className="border-b border-line last:border-0 hover:bg-surface-2">
                <td className="px-2 py-1.5 text-right text-muted">{c.rank}</td>
                <td className="px-2 py-1.5">
                  <Link href={`/${locale}/${PATHS.crypto[locale]}/${c.id}`} className="hover:text-accent">
                    <span className="font-semibold">{c.symbol}</span>{" "}
                    <span className="text-ink-2">{c.name}</span>
                  </Link>
                </td>
                <td className="px-2 py-1.5 text-right font-medium">{usd(c.price, locale)}</td>
                <td className="px-2 py-1.5 text-right">
                  <Delta change={c.changePct24h} changePct={c.changePct24h} locale={locale} showAbsolute={false} />
                </td>
                <td className="px-2 py-1.5 text-right text-ink-2">{compactUsd(c.marketCap, locale)}</td>
                <td className="px-2 py-1.5">
                  <div className="flex justify-end">
                    <Sparkline points={c.sparkline ?? []} dir={dir} />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
