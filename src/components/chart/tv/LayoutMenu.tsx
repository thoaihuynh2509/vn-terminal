"use client";

import Link from "next/link";
import { focusMenu, menuKeys, usePopover } from "./usePopover";
import type { Dict } from "@/lib/i18n";
import { IconLayout } from "./icons";

export interface LayoutChoice {
  n: number;
  /** Null when the tier cannot have this grid. */
  href: string | null;
}

/** TradingView's layout setup: one, two or four charts; the grid lives in the URL. */
export function LayoutMenu({ dict, choices, current, lockHref }: {
  dict: Dict; choices: LayoutChoice[]; current: number; lockHref: string;
}) {
  const { open, toggle, wrap, trigger, close, at } = usePopover("below-end");
  return (
    <div ref={wrap} className="relative">
      <button ref={trigger} type="button" onClick={toggle} aria-expanded={open} aria-haspopup="menu"
        aria-label={dict.chart.layout} title={dict.chart.layout}
        className="grid h-8 w-8 place-items-center rounded-md hover:bg-tv-hover">
        <IconLayout />
      </button>
      {open && (
        <div ref={focusMenu} role="menu" aria-label={dict.chart.layout} onKeyDown={menuKeys} style={at}
          className="z-40 w-48 rounded-md border border-tv-border bg-tv-bg py-1 shadow-xl">
          {choices.map((c) => c.href ? (
            <Link key={c.n} href={c.href} role="menuitem" tabIndex={-1} onClick={close} aria-current={c.n === current ? "page" : undefined}
              className={`flex items-center justify-between px-3 py-1.5 text-[13px] hover:bg-tv-hover ${
                c.n === current ? "text-tv-accent-text" : ""}`}>
              <span>{c.n} × {dict.chart.symbol}</span>
            </Link>
          ) : (
            <Link key={c.n} href={lockHref} role="menuitem" tabIndex={-1} title={dict.chart.layoutLocked}
              className="flex items-center justify-between px-3 py-1.5 text-[13px] text-tv-text-2 hover:bg-tv-hover">
              <span>{c.n} × {dict.chart.symbol}</span>
              <span aria-hidden="true">🔒</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
