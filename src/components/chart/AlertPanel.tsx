"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useStored, writeStored } from "@/lib/browser-store";
import { ALERT_LIMIT, can } from "@/lib/auth/entitlement";
import {
  add, alertKind, evaluate, newAlertId, parseAlerts, remove, reset, serializeAlerts,
  targetFromPct, STORAGE_KEY,
  type AlertCondition, type AlertKind, type PriceAlert,
} from "@/lib/alerts/alerts";
import { useAlertSync } from "@/lib/alerts/use-alert-sync";
import { num } from "@/lib/format";
import { track } from "@/lib/analytics/posthog";
import { PATHS, type Dict } from "@/lib/i18n";
import type { Locale, Tier } from "@/lib/types";

const CONDITIONS: { value: AlertCondition; key: "condAbove" | "condBelow" | "condCrossUp" | "condCrossDown" }[] = [
  { value: "cross_up", key: "condCrossUp" },
  { value: "cross_down", key: "condCrossDown" },
  { value: "above", key: "condAbove" },
  { value: "below", key: "condBelow" },
];

/**
 * Price alerts for the current symbol.
 *
 * Evaluated in the browser against the prices this page has loaded. The scope
 * note is not boilerplate — a user who believes an alert will reach them
 * overnight and finds it did not has been misled by the feature, so the panel
 * says plainly what it does.
 */
export function AlertPanel({
  symbol, current, previous, locale, dict, tier, indicators,
}: {
  symbol: string; current: number; previous?: number;
  locale: Locale; dict: Dict; tier: Tier;
  /** Readings for indicator alerts, keyed by `indicatorKey` (e.g. "rsi14"). */
  indicators?: Record<string, { current: number; previous?: number }>;
}) {
  const allowed = can(tier, "alerts:create");
  const max = ALERT_LIMIT[tier];
  const raw = useStored(STORAGE_KEY);
  const all = useMemo(() => parseAlerts(raw), [raw]);
  const mine = useMemo(() => all.filter((a) => a.symbol === symbol.toUpperCase()), [all, symbol]);

  const [condition, setCondition] = useState<AlertCondition>("cross_up");
  const [price, setPrice] = useState("");
  const [kind, setKind] = useState<AlertKind>("price");
  // Percent and RSI alerts are Plus: an RSI alert is only useful because the
  // nightly job evaluates it while the tab is closed, which is the paid part.
  const richKinds = can(tier, "alerts:email");

  // The effect ONLY writes to the external store — that is what effects are for.
  // The banner is derived from the stored alerts below rather than held in
  // separate state, which would mean setState inside the effect body and the
  // cascading re-render that causes.
  useEffect(() => {
    if (!allowed || !Number.isFinite(current)) return;
    const { alerts, fired } = evaluate(all, symbol, current, previous, Date.now(), indicators);
    if (fired.length) writeStored(STORAGE_KEY, serializeAlerts(alerts));
  }, [all, allowed, current, previous, symbol, indicators]);

  const triggered = useMemo(() => mine.filter((a) => a.triggeredAt), [mine]);

  // Alerts reach the account only on a tier that bought delivery; on free they
  // stay in this browser and fire in the open tab, which is what the scope note
  // below promises. Called before any early return — a hook cannot be
  // conditional, and the locked branch renders no alerts anyway.
  const writeAll = useCallback(
    (next: PriceAlert[]) => writeStored(STORAGE_KEY, next.length ? serializeAlerts(next) : null),
    [],
  );
  const { markDirty } = useAlertSync({ local: all, applyRemote: writeAll, canSync: can(tier, "sync:docs") });
  const save = useCallback(
    (next: PriceAlert[]) => { writeAll(next); markDirty(); },
    [writeAll, markDirty],
  );

  if (!allowed) {
    return (
      <div>
        <p className="text-[12px] leading-relaxed text-ink-2">{dict.chart.alertLocked}</p>
        <Link href={`/${locale}/${PATHS.pricing[locale]}?plan=plus`}
          className="mt-3 inline-block rounded border border-line bg-surface-2 px-3 py-1.5 text-[12px] font-medium hover:bg-surface">
          {dict.chart.unlockAll}
        </Link>
      </div>
    );
  }

  const atLimit = all.length >= max;

  function create(e: React.FormEvent) {
    e.preventDefault();
    const raw = Number(price.replace(",", "."));
    if (!Number.isFinite(raw)) return;

    const base: Omit<PriceAlert, "price"> = {
      id: newAlertId(), symbol: symbol.toUpperCase(), condition, createdAt: Date.now(),
    };
    let next: PriceAlert;
    if (kind === "pct") {
      // Resolved to a level NOW: "+5% from here" means from the price the
      // reader was looking at, not from wherever it drifts to later.
      if (!Number.isFinite(current) || current <= 0) return;
      const target = targetFromPct(current, raw);
      if (target <= 0) return;
      next = { ...base, price: target, kind: "pct", pct: raw, basePrice: current };
    } else if (kind === "indicator") {
      if (raw <= 0 || raw > 100) return; // RSI is bounded; a level outside it never fires
      next = { ...base, price: raw, kind: "indicator", indicator: "rsi", period: 14 };
    } else {
      if (raw <= 0) return;
      next = { ...base, price: raw };
    }

    save(add(all, next, max));
    track("chart_alert_created", { condition, kind, source: "panel", symbol });
    setPrice("");
  }

  /** What the reader asked for, not just the number it resolved to. */
  const describe = (a: PriceAlert) => {
    const k = alertKind(a);
    if (k === "indicator") return `RSI ${num(a.price, locale, 0)}`;
    if (k === "pct" && a.pct !== undefined) {
      const sign = a.pct > 0 ? "+" : "";
      return `${sign}${num(a.pct, locale, 2)}% · ${num(a.price, locale, 2)}`;
    }
    return num(a.price, locale, 2);
  };

  return (
    <div>
      {triggered.length > 0 && (
        <p role="status" className="mb-3 rounded border border-accent bg-surface-2 px-2.5 py-2 text-[12px] font-medium text-accent">
          {dict.chart.alertFired}: {triggered.map(describe).join(", ")}
        </p>
      )}

      <form onSubmit={create} className="space-y-2">
        <label className="sr-only" htmlFor="alert-kind">{dict.chart.alertKind}</label>
        <select id="alert-kind" value={kind} onChange={(e) => setKind(e.target.value as AlertKind)}
          className="w-full rounded border border-line bg-surface px-2 py-1.5 text-[12px] text-ink">
          <option value="price">{dict.chart.alertKindPrice}</option>
          <option value="pct" disabled={!richKinds}>
            {dict.chart.alertKindPct}{richKinds ? "" : " 🔒"}
          </option>
          <option value="indicator" disabled={!richKinds}>
            {dict.chart.alertKindIndicator}{richKinds ? "" : " 🔒"}
          </option>
        </select>
        <label className="sr-only" htmlFor="alert-cond">{dict.chart.alerts}</label>
        <select id="alert-cond" value={condition} onChange={(e) => setCondition(e.target.value as AlertCondition)}
          className="w-full rounded border border-line bg-surface px-2 py-1.5 text-[12px] text-ink">
          {CONDITIONS.map((c) => <option key={c.value} value={c.value}>{dict.chart[c.key]}</option>)}
        </select>
        <div className="flex gap-1.5">
          <label className="sr-only" htmlFor="alert-price">{dict.chart.alertPrice}</label>
          <input id="alert-price" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)}
            placeholder={kind === "pct" ? dict.chart.alertPct : kind === "indicator" ? dict.chart.alertLevel : num(current, locale, 2)}
            aria-label={kind === "pct" ? dict.chart.alertPct : kind === "indicator" ? dict.chart.alertLevel : dict.chart.alertPrice}
            className="tnum min-w-0 flex-1 rounded border border-line bg-surface px-2 py-1.5 text-[12px] text-ink placeholder:text-muted" />
          <button type="submit" disabled={atLimit || !price}
            className="rounded border border-line bg-surface-2 px-2.5 py-1.5 text-[12px] font-medium text-ink disabled:opacity-50">
            {dict.chart.alertAdd}
          </button>
        </div>
        {!richKinds && (
          <p className="text-[11px] leading-relaxed text-muted">{dict.chart.alertKindLocked}</p>
        )}
        <p className="tnum text-[11px] text-muted">
          {all.length}/{max}
          {atLimit && ` · ${dict.chart.alertLimit.replace("{n}", String(max))}`}
        </p>
      </form>

      {mine.length === 0 ? (
        <p className="mt-3 text-[12px] text-muted">{dict.chart.alertNone}</p>
      ) : (
        <ul className="mt-3 divide-y divide-line">
          {mine.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-2 py-2">
              <span className="min-w-0 text-[12px]">
                <span className="block truncate text-ink-2">
                  {dict.chart[CONDITIONS.find((c) => c.value === a.condition)!.key]}
                </span>
                <span className="tnum font-medium">{describe(a)}</span>
                {a.triggeredAt && (
                  <span className="ml-1.5 text-[10px] font-semibold uppercase text-accent">{dict.chart.alertFired}</span>
                )}
              </span>
              <span className="flex shrink-0 gap-1">
                {a.triggeredAt && (
                  <button type="button" onClick={() => save(reset(all, a.id))}
                    className="rounded border border-line px-1.5 py-1 text-[11px] text-ink-2 hover:text-ink">
                    {dict.chart.alertReset}
                  </button>
                )}
                <button type="button" onClick={() => save(remove(all, a.id))}
                  aria-label={`${dict.chart.alertDelete} ${num(a.price, locale, 2)}`}
                  className="rounded border border-line px-1.5 py-1 text-[11px] text-ink-2 hover:text-down">
                  ✕
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* Says what the feature actually does, so nobody relies on it overnight. */}
      <p className="mt-3 text-[11px] leading-relaxed text-muted">
        {can(tier, "alerts:email") ? dict.chart.alertScopeEmail : dict.chart.alertScope}
      </p>
    </div>
  );
}
