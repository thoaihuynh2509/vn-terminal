"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { grew, historyFailure, mergeBars, olderWindow, wantsOlder } from "@/lib/chart/history-window";
import { POLL_INTERVAL_MS, applyUpdate, sameBar } from "@/lib/chart/stream";
import { isSessionOpen } from "@/lib/chart/session";
import { track } from "@/lib/analytics/posthog";
import type { Bar } from "@/lib/types";

/**
 * How long to wait before re-asking for older history after a refusal that
 * might not repeat. Longer than a moment on purpose: the refusal we expect is
 * `/api/bars` rate-limiting a burst over its 60-second window, and an eager
 * retry would spend the next token on the same "no".
 */
const HISTORY_RETRY_MS = 8_000;

/** The bars the chart draws: the server's window, older history pulled in by panning, and the live bar. */
export function useSeriesBars({ barsProp, symbol, tf, fitAll = false, range = 0, offset = 0, isBusy, edge }: {
  barsProp: Bar[]; symbol: string; tf: string; fitAll?: boolean; range?: number; offset?: number;
  /** The engine's left-edge verdict and the oldest bar it was reached against; stale once older bars are prepended. */
  edge?: { near: boolean; count: number; oldest?: number };
  /** Whether a pointer gesture is under way; a polled bar waits for it to end. */
  isBusy: () => boolean;
}) {
  /**
   * Older bars fetched by panning past the left edge.
   *
   * Kept separately from the `bars` prop and merged for display, so a server
   * re-render — a timeframe change, a `router.refresh` from LiveStamp — replaces
   * the prop without silently discarding history the reader has already pulled
   * in, and without this state having to be reconciled with it.
   */
  /**
   * The series this history belongs to is stored WITH it, and a mismatch is
   * resolved by deriving an empty one during render rather than by resetting in
   * an effect. Clearing in an effect would render one frame of the previous
   * symbol's history spliced into the new symbol's chart before the reset ran.
   */
  const seriesKey = `${symbol}:${tf}`;
  const [pulled, setPulled] = useState<{ key: string; bars: Bar[]; done: boolean }>(
    { key: seriesKey, bars: [], done: false },
  );
  const history = pulled.key === seriesKey ? pulled : { key: seriesKey, bars: [], done: false };
  const exhausted = history.done;
  const loading = useRef(false);
  /**
   * Bumped when a history fetch fails for a reason that could succeed later.
   * The effect below no longer re-runs on every frame of a pan, which is what
   * made it usable — but it also means a refusal would otherwise sit there
   * until the reader happened to change something. One scheduled retry heals
   * it without reintroducing a request per frame.
   */
  const [retry, setRetry] = useState(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (retryTimer.current) clearTimeout(retryTimer.current); }, []);

  /**
   * The abort scope for history requests: one per SERIES, not one per run of
   * the effect below.
   *
   * A request is only worth cancelling when its answer has become worthless —
   * the reader moved to another symbol or interval, or left. Cancelling because
   * a dependency happened to re-run is not that, and it silently lost pages:
   * the chart syncs its own view state into the URL, that navigation hands the
   * effect a fresh `bars` prop, and the cleanup then aborted a request whose
   * bytes had already arrived. The network showed 30KB of older bars received
   * and the chart drew none of them.
   */
  const histAbort = useRef<AbortController | null>(null);
  useEffect(() => {
    const ctl = new AbortController();
    histAbort.current = ctl;
    return () => ctl.abort();
  }, [seriesKey]);

  /**
   * The last bar, kept fresh while the market is open.
   *
   * Replaces `LiveStamp`'s full-page `router.refresh`, which re-rendered every
   * pane, the rail and the board to move one candle. Only the forming bar
   * changes, so only it is fetched.
   *
   * Off-hours this does nothing at all: nothing moves after 15:00, and a poll
   * that returns the same bar forever is a request per reader per 30 seconds
   * for no information.
   */
  const [live, setLive] = useState<Bar | null>(null);
  // An unchanged bar keeps the previous object, so `bars` keeps its identity
  // and nothing downstream — every indicator included — recomputes for it.
  const takeLive = useCallback((next: Bar) => {
    setLive((prev) => (prev && sameBar(prev, next) ? prev : next));
  }, []);
  /**
   * A polled bar that arrived mid-gesture, applied on release.
   *
   * A new bar recomputes every indicator over the full series (`allPlots` keys
   * on `bars`), so one landing during a drag was a guaranteed spike in the
   * middle of the gesture. It waits for the pointer to lift instead: the same
   * values, at most one gesture later.
   */
  const heldLive = useRef<Bar | null>(null);
  // A history page landing mid-gesture recomputes every indicator inside it, so it waits for the release too.
  const heldPage = useRef<(() => void) | null>(null);

  /** What the chart actually draws: the server's window plus anything pulled in. */
  const bars = useMemo(() => {
    const merged = mergeBars(barsProp, history.bars);
    if (!live) return merged;
    const bucket = merged.length > 1 ? merged[merged.length - 1].t - merged[merged.length - 2].t : 86_400;
    return applyUpdate(merged, { symbol, tf, bar: live, final: false }, bucket);
  }, [barsProp, history.bars, live, symbol, tf]);

  /**
   * Whether the window is near enough the oldest loaded bar to ask for older
   * history — two windows ahead, see `olderLead` — so a page lands before the
   * reader reaches the edge.
   *
   * Derived here, and depended on as a BOOLEAN, because `offset` itself changes
   * sixty times a second during a drag. With `offset` in the effect's
   * dependencies below, React tore the effect down and rebuilt it on every
   * frame — and its cleanup aborts the request in flight, so a reader dragging
   * steadily into the past aborted their own history fetch before it could
   * land, over and over, while every one of those attempts still reached the
   * route. `/api/bars` allows 120 requests a minute; a burst like that spends
   * them, and the 429 that followed used to be permanent (see below). This
   * flips once, when the reader arrives, and then holds still.
   */
  const nearEdge = edge
    ? edge.near && (edge.oldest === undefined || edge.oldest === bars[0]?.t)
    : wantsOlder({ fitAll, total: bars.length, range, offset });
  const windowCount = edge ? edge.count : range;

  /**
   * Pull in older history when the window reaches the left edge.
   *
   * Guarded three ways, because this is the one place in the chart that can
   * issue a request from a pan: one flight at a time, nothing once the feed has
   * been shown to have no more, and only when the edge is actually in reach.
   * Without the `exhausted` latch the chart re-requests the same empty window
   * on every frame once it hits 2012.
   */
  useEffect(() => {
    if (exhausted || loading.current || !barsProp.length) return;
    if (!nearEdge) return;

    loading.current = true;
    const oldest = bars[0].t;
    const bucket = Math.max(60, (bars[1]?.t ?? oldest + 86400) - oldest);
    const { to } = olderWindow(oldest, bucket, Math.round(windowCount) || 120);
    const signal = histAbort.current?.signal;

    (async () => {
      try {
        const url = `/api/bars?symbol=${encodeURIComponent(symbol)}&tf=${encodeURIComponent(tf)}&before=${to}`;
        const res = await fetch(url, { signal, headers: { accept: "application/json" } });
        if (!res.ok) {
          // A failed REQUEST is not evidence that the feed has nothing older.
          // 429 — our own limiter — and any 5xx will answer differently in a
          // moment, exactly like the thrown network error the catch below
          // already forgives, so they schedule a retry and leave the latch
          // alone. Latching on these is what made one rate-limited burst kill
          // panning for a symbol until the reader changed timeframe. A 4xx
          // that is not 429 (a malformed range, 402 for a gated interval) will
          // refuse identically forever, so that one still stops the asking.
          if (historyFailure(res.status) === "retry") {
            retryTimer.current = setTimeout(() => setRetry((n) => n + 1), HISTORY_RETRY_MS);
          } else {
            setPulled({ key: seriesKey, bars: history.bars, done: true });
          }
          return;
        }
        // The route answers through `ok()`, which wraps the payload — reading
        // the body as a bare array made every page look empty, which latched
        // `exhausted` on the first fetch and disabled the feature silently.
        const body = (await res.json()) as { data?: Bar[] } | Bar[];
        const page = Array.isArray(body) ? body : (body.data ?? []);
        const merged = mergeBars(bars, Array.isArray(page) ? page : []);
        // Nothing new means the feed has nothing older — stop asking.
        if (!grew(bars, merged)) {
          setPulled({ key: seriesKey, bars: history.bars, done: true });
          return;
        }
        track("chart_history_loaded", { symbol, tf, added: merged.length - bars.length });
        // Only the part the prop does not already carry is kept, so a server
        // re-render never duplicates what it re-sends.
        const known = new Set(barsProp.map((b) => b.t));
        const apply = () => setPulled({ key: seriesKey, bars: merged.filter((b) => !known.has(b.t)), done: false });
        if (isBusy()) heldPage.current = apply;
        else apply();
      } catch {
        // Offline or aborted: the chart keeps what it has and may try again.
      } finally {
        // A held page keeps the flight open, or the same window would be asked for again.
        if (!heldPage.current) loading.current = false;
      }
    })();
    // Deliberately no cleanup: `loading` already keeps this to one flight, and
    // the series-scoped controller above owns cancellation. A cleanup here
    // would abort on every dependency change instead.
  }, [bars, barsProp, windowCount, nearEdge, symbol, tf, exhausted, seriesKey, history.bars, retry, isBusy]);

  // Polling, only while the session is open, and only for the primary chart's
  // own symbol. A companion cell in a grid polls too — each is its own chart —
  // which is why the interval is 30s rather than something tighter.
  useEffect(() => {
    if (!barsProp.length) return;
    let stopped = false;
    const poll = async () => {
      if (stopped || !isSessionOpen(new Date())) return;
      try {
        const res = await fetch(`/api/bars?symbol=${encodeURIComponent(symbol)}&tf=${encodeURIComponent(tf)}`,
          { headers: { accept: "application/json" } });
        if (!res.ok || stopped) return;
        const body = (await res.json()) as { data?: Bar[] } | Bar[];
        const page = Array.isArray(body) ? body : (body.data ?? []);
        if (page.length) {
          const next = page[page.length - 1];
          if (isBusy()) heldLive.current = next;
          else takeLive(next);
        }
      } catch {
        /* a failed poll is a missed tick, never an error the reader sees */
      }
    };
    const timer = setInterval(poll, POLL_INTERVAL_MS);
    void poll();
    return () => { stopped = true; clearInterval(timer); };
  }, [symbol, tf, barsProp.length, takeLive, isBusy]);

  const releaseHeld = useCallback(() => {
    if (heldLive.current) { takeLive(heldLive.current); heldLive.current = null; }
    if (heldPage.current) { heldPage.current(); heldPage.current = null; loading.current = false; }
  }, [takeLive]);

  return { bars, releaseHeld };
}
