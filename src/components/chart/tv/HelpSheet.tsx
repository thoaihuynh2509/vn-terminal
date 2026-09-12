"use client";

import type { Dict } from "@/lib/i18n";
import { usePopover } from "./usePopover";

/** The `?` button: every shortcut in one sheet, instead of hint lines under the chart. */
export function HelpSheet({ dict, canDraw }: { dict: Dict; canDraw: boolean }) {
  const { open, toggle, wrap, trigger, at } = usePopover("below-end");
  const rows = (["pan", "zoom", "tf", "ind", "sym", ...(canDraw ? ["draw" as const] : []), "esc"] as const)
    .map((k) => dict.chart.keys[k]);
  return (
    <div ref={wrap} className="relative">
      <button ref={trigger} type="button" onClick={toggle} aria-expanded={open} aria-haspopup="dialog"
        aria-label={dict.chart.help} title={dict.chart.help}
        className="grid h-8 w-8 place-items-center rounded-md text-[13px] font-semibold hover:bg-tv-hover">
        ?
      </button>
      {open && (
        <div role="dialog" aria-label={dict.chart.help} style={at}
          className="z-40 w-72 rounded-md border border-tv-border bg-tv-bg p-3 text-[12px] text-tv-text shadow-xl">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-tv-text-2">{dict.chart.help}</p>
          <ul className="space-y-1.5 text-tv-text-2">
            {rows.map((r) => <li key={r}>{r}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}
