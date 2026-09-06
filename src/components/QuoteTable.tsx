"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { Locale, Quote } from "@/lib/types";
import { dirClass, dirOf, equityPrice, volume } from "@/lib/format";
import { PATHS, type Dict } from "@/lib/i18n";
import { SECTOR_LABEL, sectorOf, type SectorKey } from "@/lib/sectors";
import { Delta } from "./Delta";
import { Pills } from "./layout";
import { LimitChip } from "./ui";
import { Sparkline } from "./Sparkline";
import { WatchButton } from "./WatchButton";

type SortKey = "symbol" | "price" | "changePct" | "volume";
type SectorFilter = SectorKey | "all";

/** Within a tick of the daily limit counts as at-limit; feeds round to 2dp. */
function atLimit(q: Quote, band: number): "ceiling" | "floor" | null {
  // A zero or absent reference cannot bound anything — never guess a limit from it.
  if (!q.prevClose || q.prevClose <= 0) return null;
  const eps = q.prevClose * 0.0005;
  if (q.price >= q.prevClose * (1 + band) - eps) return "ceiling";
  if (q.price <= q.prevClose * (1 - band) + eps) return "floor";
  return null;
}

export function QuoteTable({
  quotes,
  locale,
  dict,
  band = 0.07,
  showWatch = true,
  compact = false,
  sectors = false,
}: {
  quotes: Quote[];
  locale: Locale;
  dict: Dict;
  band?: number;
  showWatch?: boolean;
  /** Symbol, price and change only — for narrow columns like the home page. */
  compact?: boolean;
  /** Sector column plus a filter row — the board's way of answering "what moved banks today". */
  sectors?: boolean;
}) {
  const [sort, setSort] = useState<SortKey>("changePct");
  const [desc, setDesc] = useState(true);
  const [sector, setSector] = useState<SectorFilter>("all");

  // Only sectors that actually have a row get a pill; an empty filter is a dead button.
  const present = useMemo(() => {
    const have = new Set(quotes.map((q) => sectorOf(q.symbol)));
    return (Object.keys(SECTOR_LABEL) as SectorKey[]).filter((k) => have.has(k));
  }, [quotes]);

  const rows = useMemo(() => {
    const copy = sector === "all" ? [...quotes] : quotes.filter((q) => sectorOf(q.symbol) === sector);
    copy.sort((a, b) => {
      const av = sort === "symbol" ? a.symbol : (a[sort] ?? 0);
      const bv = sort === "symbol" ? b.symbol : (b[sort] ?? 0);
      const cmp = typeof av === "string" ? av.localeCompare(bv as string) : (av as number) - (bv as number);
      return desc ? -cmp : cmp;
    });
    return copy;
  }, [quotes, sort, desc, sector]);

  function head(key: SortKey, label: string, align: "left" | "right" = "right") {
    const on = sort === key;
    return (
      <th
        scope="col"
        aria-sort={on ? (desc ? "descending" : "ascending") : "none"}
        className={`px-2 py-2 font-medium ${align === "right" ? "text-right" : "text-left"}`}
      >
        <button
          type="button"
          onClick={() => (on ? setDesc(!desc) : (setSort(key), setDesc(true)))}
          className="inline-flex items-center gap-1 hover:text-ink"
        >
          {label}
          <span aria-hidden="true" className={on ? "text-ink" : "text-transparent"}>{desc ? "↓" : "↑"}</span>
        </button>
      </th>
    );
  }

  return (
    <div>
      {sectors && (
        <div className="mb-3">
          <Pills
            label={dict.stocks.sector}
            value={sector}
            onChange={setSector}
            options={[
              { value: "all" as SectorFilter, label: dict.stocks.filterAll },
              ...present.map((k) => ({ value: k as SectorFilter, label: SECTOR_LABEL[k][locale] })),
            ]}
          />
        </div>
      )}
      <div className="card relative overflow-x-auto">
      <table className={`data-table w-full text-[13px] ${compact ? "min-w-[300px]" : sectors ? "min-w-[800px]" : "min-w-[680px]"}`}>
        <caption className="sr-only">
          {dict.stocks.title} — {dict.common.unit}: {dict.common.thousandVnd}
        </caption>
        <thead className="border-b border-line bg-surface-2 text-[11px] uppercase tracking-wide text-muted">
          <tr>
            {showWatch && <th scope="col" className="w-8 px-2 py-2" />}
            {head("symbol", dict.common.symbol, "left")}
            {sectors && <th scope="col" className="px-2 py-2 text-left font-medium">{dict.stocks.sector}</th>}
            {head("price", dict.common.price)}
            {head("changePct", dict.common.changePct)}
            {!compact && (
              <>
                <th scope="col" className="px-2 py-2 text-right font-medium">{dict.common.high} / {dict.common.low}</th>
                {head("volume", dict.common.volume)}
                <th scope="col" className="px-2 py-2 text-right font-medium">{dict.stocks.trend}</th>
              </>
            )}
          </tr>
        </thead>
        <tbody className="tnum">
          {rows.map((q) => {
            const dir = dirOf(q.change);
            const limit = atLimit(q, band);
            return (
              <tr key={q.symbol} className="border-b border-line last:border-0 hover:bg-surface-2">
                {showWatch && (
                  <td className="px-2 py-1.5">
                    <WatchButton symbol={q.symbol} addLabel={dict.stocks.addWatch} removeLabel={dict.stocks.removeWatch} />
                  </td>
                )}
                <td className="px-2 py-1.5">
                  <Link href={`/${locale}/${PATHS.terminal[locale]}/${q.symbol}`} className="font-semibold hover:text-accent">
                    {q.symbol}
                  </Link>
                  {limit && (
                    <LimitChip
                      kind={limit}
                      label={limit === "ceiling" ? dict.stocks.ceilingShort : dict.stocks.floorShort}
                    />
                  )}
                </td>
                {sectors && (
                  <td className="px-2 py-1.5 text-[12px] text-ink-2">{SECTOR_LABEL[sectorOf(q.symbol)][locale]}</td>
                )}
                {/* Coloured but not glyphed: the ▲/▼ lives in the change cell
                    beside it, so the row still encodes direction without colour
                    while avoiding two arrows per row. */}
                <td className={`px-2 py-1.5 text-right font-medium ${dirClass(dir)}`}>
                  {equityPrice(q.price, locale)}
                </td>
                <td className="px-2 py-1.5 text-right">
                  <Delta change={q.change} changePct={q.changePct} locale={locale} />
                </td>
                {!compact && (
                  <>
                    <td className="px-2 py-1.5 text-right text-ink-2">
                      {q.high !== undefined ? equityPrice(q.high, locale) : "—"} /{" "}
                      {q.low !== undefined ? equityPrice(q.low, locale) : "—"}
                    </td>
                    <td className="px-2 py-1.5 text-right text-ink-2">{q.volume ? volume(q.volume, locale) : "—"}</td>
                    <td className="px-2 py-1.5">
                      <div className="flex justify-end">
                        {q.spark && q.spark.length > 2 ? (
                          <Sparkline points={q.spark} dir={dir} width={72} height={22} />
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </div>
                    </td>
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
    </div>
  );
}
