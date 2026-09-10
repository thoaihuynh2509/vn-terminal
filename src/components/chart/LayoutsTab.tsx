"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useStored, writeStored } from "@/lib/browser-store";
import { track } from "@/lib/analytics/posthog";
import { GateHint } from "@/components/chart/GateHint";
import { LAYOUT_LIMIT, can } from "@/lib/auth/entitlement";
import { PATHS, type Dict } from "@/lib/i18n";
import {
  LAYOUTS_KEY, layoutFromQuery, layoutQuery, mergeLayouts, normaliseName,
  parseLayouts, removeLayout, serializeLayouts, upsertLayout, type SavedLayout,
} from "@/lib/chart/layouts";
import type { Locale, Tier } from "@/lib/types";

/**
 * Saved chart setups.
 *
 * `LAYOUT_LIMIT` was defined before the roadmap and `/api/docs` has enforced it
 * since P1-2, but nothing ever wrote a layout — the cap guarded writes that
 * could not happen. This is its consumer.
 *
 * Local-first, the same deal drawings get: every tier's layouts live in this
 * browser and render from there, and paid tiers additionally mirror them to the
 * account. `/api/docs` requires `sync:docs`, so a free reader's layouts never
 * reach the network at all — which is why the free ceiling is enforced here,
 * from the same constant the server re-checks against, and why the panel says
 * plainly where a reader's setups are kept.
 *
 * What is captured is the ADDRESS BAR, not chart internals: P1-12 already made
 * the URL the source of truth for symbol, interval, indicators, grid and range,
 * so reading it is both simpler and impossible to get out of step with what is
 * actually on screen.
 */
export function LayoutsTab({
  locale, dict, tier, symbol,
}: {
  locale: Locale; dict: Dict; tier: Tier; symbol: string;
}) {
  const router = useRouter();
  const raw = useStored(LAYOUTS_KEY);
  const layouts = useMemo(() => parseLayouts(raw), [raw]);

  const limit = LAYOUT_LIMIT[tier];
  const canSync = can(tier, "sync:docs");
  const canSave = limit > 0;

  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [hitLimit, setHitLimit] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const write = useCallback((list: SavedLayout[]) => {
    writeStored(LAYOUTS_KEY, serializeLayouts(list));
  }, []);

  const say = useCallback((msg: string) => {
    setFlash(msg);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 2000);
  }, []);

  useEffect(() => () => { if (flashTimer.current) clearTimeout(flashTimer.current); }, []);

  // Pull the account's layouts once. A saved setup is a deliberate act rather
  // than a stream of edits, so this needs no debounced reconciler — unlike
  // drawings, which is why `useSyncedDoc` is not used here.
  useEffect(() => {
    if (!canSync) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/docs?kind=layout", { headers: { accept: "application/json" } });
        if (!res.ok) return; // 401/402/501: keep working locally, never an error
        const body = (await res.json()) as { data?: { key: string; data: unknown }[] };
        const remote = (body.data ?? [])
          .map((row) => parseLayouts(JSON.stringify([row.data]))[0])
          .filter((l): l is SavedLayout => !!l);
        if (cancelled || !remote.length) return;
        writeStored(
          LAYOUTS_KEY,
          serializeLayouts(mergeLayouts(parseLayouts(localStorage.getItem(LAYOUTS_KEY)), remote)),
        );
      } catch {
        /* offline: the local copy is still correct */
      }
    })();
    return () => { cancelled = true; };
  }, [canSync]);

  const push = useCallback(async (l: SavedLayout) => {
    if (!canSync) return;
    try {
      await fetch("/api/docs", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "layout", key: l.name, data: l }),
        keepalive: true,
      });
    } catch { /* the local save already happened; the next mount reconciles */ }
  }, [canSync]);

  const save = useCallback(() => {
    const clean = normaliseName(name);
    const captured = layoutFromQuery(clean, symbol, window.location.search, Date.now());
    if (!captured) { setError(dict.chart.layoutBadName); return; }

    const result = upsertLayout(layouts, captured, tier);
    if (!result.ok) {
      if (result.error === "limit") {
        setError(dict.chart.layoutLimit.replace("{n}", String(result.limit ?? limit)));
        track("chart_limit_hit", { gate: "layout", tier, limit });
        setHitLimit(true);
      } else {
        setError(dict.chart.layoutBadName);
      }
      return;
    }
    setError(null);
    write(result.list!);
    setName("");
    say(dict.chart.layoutSaved);
    void push(captured);
    track("chart_layout_saved", { tier, count: result.list!.length, grid: captured.grid, synced: canSync });
  }, [name, symbol, layouts, tier, limit, dict, write, say, push, canSync]);

  const open = useCallback((l: SavedLayout) => {
    const q = layoutQuery(l);
    track("chart_layout_opened", { tier, grid: l.grid });
    router.push(`/${locale}/${PATHS.terminal[locale]}/${l.symbol}${q ? `?${q}` : ""}`);
  }, [locale, router, tier]);

  const drop = useCallback((l: SavedLayout) => {
    write(removeLayout(layouts, l.name));
    if (canSync) {
      void fetch(`/api/docs?kind=layout&key=${encodeURIComponent(l.name)}`, { method: "DELETE" })
        .catch(() => { /* removed locally; the account copy is cleaned next time */ });
    }
  }, [layouts, write, canSync]);

  const rename = useCallback((l: SavedLayout) => {
    const next = normaliseName(window.prompt(dict.chart.layoutRename, l.name) ?? "");
    if (!next || next === l.name) return;
    // Rename is a delete plus a save, so it goes through the same cap and the
    // same name rules rather than a second, subtly different code path.
    const moved = { ...l, name: next, savedAt: Date.now() };
    const result = upsertLayout(removeLayout(layouts, l.name), moved, tier);
    if (!result.ok) { setError(dict.chart.layoutBadName); return; }
    setError(null);
    write(result.list!);
    void push(moved);
    if (canSync) {
      void fetch(`/api/docs?kind=layout&key=${encodeURIComponent(l.name)}`, { method: "DELETE" })
        .catch(() => { /* the old key is cleaned on the next reconcile */ });
    }
  }, [layouts, tier, dict, write, push, canSync]);

  if (!canSave) {
    return (
      <div>
        <p className="text-[12px] leading-relaxed text-ink-2">{dict.chart.layoutAnon}</p>
        <Link href={`/${locale}/${PATHS.login[locale]}`}
          className="mt-3 inline-block rounded-lg border border-line bg-page px-3 py-1.5 text-[12px] font-medium hover:bg-surface">
          {dict.auth.signIn}
        </Link>
      </div>
    );
  }

  return (
    <div>
      <p className="text-[12px] leading-relaxed text-muted">{dict.chart.layoutHint}</p>

      <div className="mt-2.5 flex gap-1.5">
        <label htmlFor="layout-name" className="sr-only">{dict.chart.layoutName}</label>
        <input
          id="layout-name" value={name} onChange={(e) => { setName(e.target.value); setError(null); }}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); save(); } }}
          placeholder={dict.chart.layoutNamePlaceholder} maxLength={64}
          className="min-w-0 flex-1 rounded-lg border border-line bg-page px-2 py-1 text-[12px]"
        />
        <button type="button" onClick={save} disabled={!name.trim()}
          className="shrink-0 rounded-lg border border-line bg-page px-2.5 py-1 text-[12px] font-medium hover:bg-surface disabled:opacity-50">
          {dict.chart.layoutSave}
        </button>
      </div>

      {/* Announced, not just coloured: the save outcome must reach a reader who
          is not watching this corner of the screen. */}
      <p aria-live="polite" className="mt-1 text-[11px] text-muted">
        {error ? <span className="text-down">{error}</span> : flash ?? ""}
      </p>

      <p className="mt-1 flex items-center justify-between text-[11px] text-muted">
        <span className="tnum">
          {dict.chart.layoutCount.replace("{n}", String(layouts.length)).replace("{max}", String(limit))}
        </span>
        <span>{canSync ? dict.chart.layoutSynced : dict.chart.layoutLocalOnly}</span>
      </p>

      {hitLimit && (
        <GateHint gate="layout" limit={limit} locale={locale} dict={dict} tier={tier}
          onClose={() => setHitLimit(false)} />
      )}

      {layouts.length === 0 ? (
        <p className="mt-3 text-[12px] text-muted">{dict.chart.layoutNone}</p>
      ) : (
        <ul className="mt-2 divide-y divide-line border-t border-line">
          {layouts.map((l) => (
            <li key={l.name} className="flex items-center gap-1 py-1.5">
              <button type="button" onClick={() => open(l)}
                className="min-w-0 flex-1 text-left text-[12px] hover:text-accent">
                <span className="block truncate font-medium">{l.name}</span>
                <span className="block truncate text-[11px] text-muted">
                  {[l.symbol, ...l.extra].join(" · ")} · {l.tf}
                  {l.grid > 1 ? ` · ${l.grid}` : ""}
                </span>
              </button>
              <button type="button" onClick={() => rename(l)} aria-label={`${dict.chart.layoutRename} ${l.name}`}
                className="shrink-0 px-1.5 py-0.5 text-[11px] text-muted hover:text-ink">
                <span aria-hidden="true">✎</span>
              </button>
              <button type="button" onClick={() => drop(l)} aria-label={`${dict.chart.layoutDelete} ${l.name}`}
                className="shrink-0 px-1.5 py-0.5 text-[11px] text-muted hover:text-down">
                <span aria-hidden="true">×</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {!canSync && (
        <Link href={`/${locale}/${PATHS.pricing[locale]}?plan=plus`}
          className="mt-3 inline-block text-[12px] font-medium text-accent hover:underline">
          {dict.chart.layoutSynced} →
        </Link>
      )}
    </div>
  );
}
