"use client";

import { useMemo, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { TV_RANGES, rangeForCount, rangeView } from "@/lib/chart/range-interval";
import { can } from "@/lib/auth/entitlement";
import { track } from "@/lib/analytics/posthog";
import { SCALES } from "@/lib/chart/scale";
import { usePopover } from "./usePopover";
import type { Dict } from "@/lib/i18n";
import { useStoreValue } from "../valueStore";
import { IconCalendar, IconTable } from "./icons";
import { useWorkspace, type WorkspaceApi } from "./store";

const cell = "h-7 shrink-0 rounded-md px-2 text-[13px] hover:bg-tv-hover";

/** Where a range that needs another interval navigates: the chart path and the grid params to keep. */
export interface RangeLink { base: string; extraQuery: string }

/** TradingView's bottom toolbar: ranges, go to date, the exchange clock and the scale switches. */
export function BottomBar({ dict, rangeLink }: { dict: Dict; rangeLink: RangeLink }) {
  const ws = useWorkspace();
  return (
    <div className="relative flex h-[38px] shrink-0 items-center gap-0.5 overflow-x-auto border-t border-tv-border px-2 text-tv-text">
      {ws && <Ranges ws={ws} dict={dict} link={rangeLink} />}
      {ws && <GoTo ws={ws} dict={dict} />}
      <span className="min-w-2 flex-1" />
      {ws && <BarCount ws={ws} label={dict.chart.bars} />}
      <Clock />
      {ws && (
        <>
          <span aria-hidden="true" className="mx-1 h-5 w-px shrink-0 bg-tv-border" />
          <div role="group" aria-label={dict.chart.scale} className="flex shrink-0">
            {SCALES.map((sc) => (
              <button key={sc} type="button" aria-pressed={ws.scale === sc} title={dict.chart.scaleHint[sc]}
                onClick={() => ws.setScale(sc)}
                className={`${cell} ${ws.scale === sc ? "text-tv-accent-text" : ""}`}>
                {dict.chart.scaleLabel[sc]}
              </button>
            ))}
          </div>
          <button type="button" aria-pressed={ws.asTable} onClick={() => ws.setAsTable(!ws.asTable)}
            title={ws.asTable ? dict.common.chartView : dict.common.tableView}
            className={`${cell} grid place-items-center ${ws.asTable ? "text-tv-accent-text" : ""}`}>
            <IconTable />
            <span className="sr-only">{ws.asTable ? dict.common.chartView : dict.common.tableView}</span>
          </button>
        </>
      )}
    </div>
  );
}

function Ranges({ ws, dict, link }: { ws: WorkspaceApi; dict: Dict; link: RangeLink }) {
  const router = useRouter();
  const count = useStoreValue(ws.shown);
  const intraday = can(ws.tier, "chart:intraday");
  const bars = useStoreValue(ws.bars);
  const active = useMemo(() => rangeForCount(bars, count, ws.tf, intraday), [bars, count, ws.tf, intraday]);
  return (
    <div role="group" aria-label={dict.chart.range} className="flex shrink-0">
      {TV_RANGES.map((id) => {
        const view = rangeView(id, intraday);
        const go = () => {
          if (!view) { ws.raiseGate({ gate: "intraday" }); return; }
          if (view.tf === null || view.tf === ws.tf) { ws.pickRange(id); return; }
          track("chart_range_changed", { range: id, tf: view.tf });
          router.push(`${link.base}?tf=${encodeURIComponent(view.tf)}${link.extraQuery}&r=${id}`);
        };
        return (
          <button key={id} type="button" aria-pressed={active === id} aria-disabled={view ? undefined : true}
            title={view ? undefined : dict.chart.tfLocked} onClick={go}
            className={`${cell} ${active === id ? "text-tv-accent-text" : ""} ${view ? "" : "opacity-50"}`}>
            {id === "ALL" ? dict.chart.all : id}
          </button>
        );
      })}
    </div>
  );
}

function GoTo({ ws, dict }: { ws: WorkspaceApi; dict: Dict }) {
  const { open, toggle, wrap, trigger, close, at } = usePopover("above-start", 280);
  return (
    <div ref={wrap} className="relative">
      <button ref={trigger} type="button" onClick={toggle} aria-expanded={open} aria-haspopup="dialog"
        aria-label={dict.chart.goToDate} title={dict.chart.goToDate} className={`${cell} grid place-items-center`}>
        <IconCalendar />
      </button>
      {open && (
        <form role="dialog" aria-label={dict.chart.goToDate} style={at}
          className="z-40 flex gap-1 rounded-md border border-tv-border bg-tv-bg p-2 shadow-xl"
          onSubmit={(e) => {
            e.preventDefault();
            const v = new FormData(e.currentTarget).get("d");
            const t = typeof v === "string" && v ? Date.parse(`${v}T09:00:00+07:00`) / 1000 : NaN;
            if (Number.isFinite(t)) { ws.goTo(t); close(); }
          }}>
          <input type="date" name="d" aria-label={dict.chart.goToDate}
            className="rounded-md border border-tv-text-2 bg-transparent px-2 py-1 text-[13px]" />
          <button type="submit" className="rounded-md bg-tv-accent px-3 text-[13px] font-medium text-white">OK</button>
        </form>
      )}
    </div>
  );
}

function BarCount({ ws, label }: { ws: WorkspaceApi; label: string }) {
  const count = useStoreValue(ws.shown);
  return <span className="tnum shrink-0 px-2 text-[12px] text-tv-text-2">{count} {label}</span>;
}

const clockFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });

const tick = (notify: () => void) => {
  const id = setInterval(notify, 1000);
  return () => clearInterval(id);
};
const second = () => Math.floor(Date.now() / 1000);
const noClock = () => null;

function Clock() {
  const now = useSyncExternalStore(tick, second, noClock);
  return (
    <span className="tnum shrink-0 px-2 text-[13px]">
      {now === null ? "" : `${clockFmt.format(now * 1000)} UTC+7`}
    </span>
  );
}
