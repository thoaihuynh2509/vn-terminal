"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Dict } from "@/lib/i18n";
import { IconDelete, IconPlus } from "./icons";
import { usePopover } from "./usePopover";

export interface CompareInfo {
  current: string[];
  /** The chart's URL without `cmp`; the menu appends its own. */
  base: string;
  allowed: boolean;
  lockHref: string;
  suggestions: string[];
}

/** TradingView's "+": overlay other symbols on the chart; the list lives in the URL. */
export function CompareMenu({ dict, info }: { dict: Dict; info: CompareInfo }) {
  const { open, show, wrap, trigger, close, at } = usePopover("below-start", 288);
  const [q, setQ] = useState("");
  const router = useRouter();
  const btn = "grid h-8 w-8 place-items-center rounded-md hover:bg-tv-hover";
  if (!info.allowed) {
    return (
      <Link href={info.lockHref} title={dict.chart.compareLock} aria-label={`${dict.chart.compareAdd} — ${dict.chart.compareLock}`} className={btn}>
        <IconPlus />
      </Link>
    );
  }
  const go = (list: string[]) => {
    close();
    router.push(list.length ? `${info.base}&cmp=${list.join(",")}` : info.base);
  };
  const needle = q.trim().toUpperCase();
  const options = info.suggestions.filter((s) => !info.current.includes(s) && (!needle || s.includes(needle))).slice(0, 12);
  return (
    <div ref={wrap} className="relative">
      <button ref={trigger} type="button" onClick={() => { if (open) close(); else { setQ(""); show(); } }}
        aria-expanded={open} aria-haspopup="dialog" aria-label={dict.chart.compareAdd} title={dict.chart.compareAdd} className={btn}>
        <IconPlus />
      </button>
      {open && (
        <div role="dialog" aria-label={dict.chart.compareAdd} style={at}
          className="z-40 w-72 rounded-md border border-tv-border bg-tv-bg shadow-xl">
          <form className="border-b border-tv-border p-2"
            onSubmit={(e) => { e.preventDefault(); if (/^[A-Z0-9:]{2,12}$/.test(needle)) go([...info.current, needle]); }}>
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={dict.chart.compareSearch}
              aria-label={dict.chart.compareSearch}
              className="w-full rounded-md border border-tv-text-2 bg-transparent px-2 py-1.5 text-[13px] uppercase outline-none focus:border-tv-accent" />
          </form>
          {info.current.length === 0 && <p className="px-3 pt-2 text-[12px] text-tv-text-2">{dict.chart.compareNone}</p>}
          <ul>
            {info.current.map((s) => (
              <li key={s} className="flex items-center justify-between px-3 py-1.5 text-[13px]">
                <span className="font-semibold">{s}</span>
                <button type="button" onClick={() => go(info.current.filter((x) => x !== s))}
                  aria-label={`${dict.chart.remove} ${s}`} className="grid h-6 w-6 place-items-center rounded hover:bg-tv-hover">
                  <IconDelete />
                </button>
              </li>
            ))}
          </ul>
          <ul className="max-h-64 overflow-y-auto border-t border-tv-border py-1">
            {options.map((s) => (
              <li key={s}>
                <button type="button" onClick={() => go([...info.current, s])}
                  className="w-full px-3 py-1.5 text-left text-[13px] hover:bg-tv-hover">
                  {s}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
