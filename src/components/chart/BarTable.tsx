"use client";

import { num, volume as fmtVol } from "@/lib/format";
import type { Dict } from "@/lib/i18n";
import type { Bar, Locale } from "@/lib/types";
import { stamp } from "./chartShared";

export function BarTable({ bars, locale, dict, digits, intraday }: { bars: Bar[]; locale: Locale; dict: Dict; digits: number; intraday: boolean }) {
  return (
    <div className="card relative mt-2 max-h-[420px] overflow-auto">
      <table className="data-table tnum w-full text-[12px]">
        <caption className="sr-only">{dict.stocks.chartTitle}</caption>
        <thead className="text-left text-muted">
          <tr>
            <th scope="col" className="px-2 font-medium">{dict.common.updated}</th>
            <th scope="col" className="px-2 text-right font-medium">{dict.common.open}</th>
            <th scope="col" className="px-2 text-right font-medium">{dict.common.high}</th>
            <th scope="col" className="px-2 text-right font-medium">{dict.common.low}</th>
            <th scope="col" className="px-2 text-right font-medium">{dict.common.price}</th>
            <th scope="col" className="px-2 text-right font-medium">{dict.common.volume}</th>
          </tr>
        </thead>
        <tbody>
          {[...bars].reverse().map((b) => (
            <tr key={b.t} className="cv-row border-t border-line">
              <td className="px-2">{stamp(b.t, locale, intraday)}</td>
              <td className="px-2 text-right">{num(b.o, locale, digits)}</td>
              <td className="px-2 text-right">{num(b.h, locale, digits)}</td>
              <td className="px-2 text-right">{num(b.l, locale, digits)}</td>
              <td className={`px-2 text-right ${b.c >= b.o ? "text-up" : "text-down"}`}>
                <span aria-hidden="true">{b.c >= b.o ? "▲" : "▼"}</span> {num(b.c, locale, digits)}
              </td>
              <td className="px-2 text-right text-ink-2">{b.v ? fmtVol(b.v, locale) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
