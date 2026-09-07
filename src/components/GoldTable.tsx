import Link from "next/link";
import { PATHS } from "@/lib/i18n";
import { GOLD_SERIES, seriesSymbol } from "@/lib/chart/series";
import type { GoldSnapshot, Locale } from "@/lib/types";
import { vnd } from "@/lib/format";
import type { Dict } from "@/lib/i18n";
import { Delta } from "./Delta";

export function GoldTable({
  gold,
  locale,
  dict,
  limit,
}: {
  gold: GoldSnapshot;
  locale: Locale;
  dict: Dict;
  limit?: number;
}) {
  const rows = limit ? gold.rows.slice(0, limit) : gold.rows;

  return (
    <div className="card relative overflow-x-auto">
      <table className="data-table w-full min-w-[600px] text-[13px]">
        <caption className="sr-only">
          {dict.gold.title} — {dict.gold.perLuongNote}
        </caption>
        <thead className="border-b border-line bg-surface-2 text-[11px] uppercase tracking-wide text-muted">
          <tr>
            <th scope="col" className="px-2 py-2 text-left font-medium">{dict.common.name}</th>
            <th scope="col" className="px-2 py-2 text-right font-medium">{dict.gold.buy}</th>
            <th scope="col" className="px-2 py-2 text-right font-medium">{dict.gold.sell}</th>
            <th scope="col" className="px-2 py-2 text-right font-medium">{dict.common.change}</th>
            <th scope="col" className="px-2 py-2 text-right font-medium">{dict.gold.spread}</th>
          </tr>
        </thead>
        <tbody className="tnum">
          {rows.map((r) => (
            <tr key={r.code} className="border-b border-line last:border-0 hover:bg-surface-2">
              {/* Only the series we actually record are linked: a link to a
                  chart with nothing behind it is worse than no link. */}
              <th scope="row" className="px-2 py-1.5 text-left font-medium">
                {(GOLD_SERIES as readonly string[]).includes(r.code) ? (
                  <Link href={`/${locale}/${PATHS.terminal[locale]}/${seriesSymbol(r.code)}`}
                    className="hover:text-accent hover:underline" title={dict.chart.seriesGoldChart}>
                    {r.name}
                  </Link>
                ) : r.name}
              </th>
              <td className="px-2 py-1.5 text-right">{vnd(r.buy, locale)}</td>
              <td className="px-2 py-1.5 text-right font-medium">{vnd(r.sell, locale)}</td>
              <td className="px-2 py-1.5 text-right">
                {/* Delta renders the flat case as a bare dash itself — no local
                    "— 0" branch, which is exactly what it existed to prevent. */}
                <Delta
                  change={r.changeSell || r.changeBuy}
                  locale={locale}
                  digits={0}
                  changePct={
                    r.changeSell || r.changeBuy
                      ? ((r.changeSell || r.changeBuy) / (r.sell || r.buy)) * 100
                      : undefined
                  }
                />
              </td>
              <td className="px-2 py-1.5 text-right text-ink-2">
                {r.sell > r.buy ? vnd(r.sell - r.buy, locale) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="border-t border-line px-2 py-1.5 text-[11px] text-muted">
        {dict.gold.perLuongNote} · {dict.common.updated} {gold.updatedAt} · {gold.date}
      </p>
    </div>
  );
}
