"use client";

import { useEffect, useId, useRef, useState } from "react";
import { getDict, PATHS } from "@/lib/i18n";
import type { Locale, Tier } from "@/lib/types";
import { track } from "@/lib/analytics/posthog";
import { priceFor } from "@/lib/billing/plans";
import { vnd } from "@/lib/format";

interface Turn {
  question: string;
  answer: string;
  capturedAt: string;
}

const SUGGESTIONS: Record<Locale, string[]> = {
  vi: ["Mã nào tăng mạnh nhất phiên này?", "Giá vàng SJC hôm nay bao nhiêu?", "VNINDEX đang ở mức nào?", "Vàng SJC chênh bao nhiêu so với thế giới?"],
  en: ["Which stocks gained most this session?", "What is the SJC gold price?", "Where is the VNINDEX?", "How far is SJC gold above world parity?"],
};

/** Impressions already counted this page-load, so arrival is not an event storm. */
const SEEN = new Set<string>();

const SYMBOL_SUGGESTIONS: Record<Locale, string[]> = {
  vi: ["{sym} đóng cửa ở đâu so với hôm qua?", "Khối lượng {sym} phiên này?", "{sym} đã đi thế nào trong tháng qua?"],
  en: ["Where did {sym} close versus yesterday?", "What was {sym}'s volume today?", "How has {sym} moved over the past month?"],
};

export function AskBox({ locale, isMock, tier, symbol, freeAsks = null, compact = false }: {
  locale: Locale; isMock: boolean;
  /** Decides whether the upsell asks for an account or for money. */
  tier: Tier;
  /** Symbol on screen — attached to the snapshot the model answers from. */
  symbol?: string;
  /**
   * Free asks left, counted on the server, `null` for a subscriber.
   *
   * Passed in rather than fetched because the count has to be readable BEFORE
   * the first question: a trial nobody is told about is not a trial, it is a
   * wall that arrives without warning.
   */
  freeAsks?: number | null;
  compact?: boolean;
}) {
  const dict = getDict(locale);
  const anon = tier === "anon";
  const titleId = useId();
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A reader with nothing left cannot ask, so the upgrade state is where they
  // already are — not one wasted round-trip and a 402 away.
  const [locked, setLocked] = useState(freeAsks === 0);
  const [freeLeft, setFreeLeft] = useState<number | null>(freeAsks);
  const logRef = useRef<HTMLDivElement>(null);
  const lockRef = useRef<HTMLDivElement>(null);
  const wasLocked = useRef(locked);

  /**
   * Spending the last ask unmounts the form the reader was standing in, so
   * focus has to be caught — otherwise it falls to `<body>` and their next Tab
   * restarts at the top of the page, with the offer they were just shown the
   * furthest thing away. Only on the false→true transition: a reader who
   * arrives already spent has not moved focus anywhere to lose it.
   */
  useEffect(() => {
    if (locked && !wasLocked.current) lockRef.current?.focus();
    wasLocked.current = locked;
  }, [locked]);

  // Counted once per page, not once per render: this gate is shown on arrival
  // rather than on an action, so re-firing would inflate its impressions
  // against every other gate's.
  useEffect(() => {
    if (!locked || SEEN.has("ai")) return;
    SEEN.add("ai");
    track("upgrade_prompt_shown", { gate: "ai", tier, surface: "askbox" });
  }, [locked, tier]);

  async function submit(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, locale, symbol }),
      });
      if (res.status === 429) {
        setError(dict.ask.rateLimited);
        return;
      }
      if (res.status === 402) {
        setLocked(true);
        return;
      }
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? "failed");
      setTurns((t) => [...t, { question: q, answer: json.data.answer, capturedAt: json.data.capturedAt }]);
      setQuestion("");
      // The server returns this only while the free teaser is being spent.
      if (typeof json.data.freeRemaining === "number") {
        setFreeLeft(json.data.freeRemaining);
        if (json.data.freeRemaining === 0) setLocked(true);
      }
      track("ai_asked", { teaser: typeof json.data.freeRemaining === "number" });
    } catch {
      setError(dict.ask.error);
    } finally {
      setBusy(false);
    }
  }

  const stamp = (iso: string) =>
    new Intl.DateTimeFormat(locale === "vi" ? "vi-VN" : "en-US", {
      hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit", timeZone: "Asia/Ho_Chi_Minh",
    }).format(new Date(iso));

  return (
    <div>
      {isMock && (
        <p role="note" className="mb-4 rounded-lg border border-line bg-surface px-3 py-2.5 text-[12px] text-ink-2">
          {dict.ask.mockNotice}
        </p>
      )}

      {!locked && (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(question);
        }}
        className="flex flex-wrap gap-2"
      >
        <label htmlFor="ask-input" className="sr-only">{dict.ask.title}</label>
        <input
          id="ask-input"
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={dict.ask.placeholder}
          maxLength={500}
          disabled={busy}
          className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-[14px] text-ink placeholder:text-muted disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={busy || !question.trim()}
          className="rounded-lg border border-line bg-page px-4 py-2 text-[13px] font-medium text-ink disabled:opacity-50"
        >
          {busy ? dict.ask.sending : dict.ask.send}
        </button>
        {turns.length > 0 && (
          <button
            type="button"
            onClick={() => { setTurns([]); setError(null); }}
            className="rounded-lg border border-line px-3 py-2 text-[13px] text-ink-2 hover:text-ink"
          >
            {dict.ask.clear}
          </button>
        )}
      </form>
      )}

      {freeLeft !== null && freeLeft > 0 && !locked && (
        <p className="mt-2.5 text-[12px] text-ink-2">
          {dict.ask.freeLeft.replace("{n}", String(freeLeft))}
        </p>
      )}

      {turns.length === 0 && !locked && (
        <div className="mt-4">
          <p className="text-[12px] font-medium uppercase tracking-wide text-muted">{dict.ask.suggestions}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {(symbol ? SYMBOL_SUGGESTIONS[locale].map((t) => t.replace("{sym}", symbol)) : SUGGESTIONS[locale]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => submit(s)}
                disabled={busy}
                className="rounded-lg border border-line px-2.5 py-1.5 text-[12px] text-ink-2 hover:bg-surface-2 hover:text-ink disabled:opacity-50"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {locked && (
        // Focused rather than announced through a live region: a `role="status"`
        // inserted already full is routinely dropped by NVDA and VoiceOver, and
        // it would race the answer log's own polite region in the same commit.
        // Moving focus to a labelled container announces deterministically.
        <div ref={lockRef} tabIndex={-1} aria-labelledby={titleId} className="mt-4 card p-4">
          <h3 id={titleId} className="text-[13px] font-medium">{dict.ask.upgradeTitle}</h3>
          {/* What the money buys, stated as capabilities rather than as a
              slogan — and the price comes from `plans.ts`, so this box and the
              pricing page cannot drift into disagreeing about what Plus costs. */}
          <ul className="mt-2 space-y-1 text-[12px] leading-relaxed text-ink-2">
            <li>{dict.ask.upgradeUnlimited}</li>
            <li>{dict.ask.upgradeIncludes}</li>
          </ul>
          <p className="mt-3 text-[12px] text-ink-2">
            {dict.ask.upgradePrice.replace("{price}", vnd(priceFor("plus", "monthly").amount, locale))}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <a href={anon ? `/${locale}/${PATHS.login[locale]}` : `/${locale}/${PATHS.pricing[locale]}?plan=plus`}
              onClick={() => track("upgrade_prompt_clicked", { gate: "ai", tier, surface: "askbox" })}
              className="rounded-lg border border-line bg-page px-3 py-1.5 text-[13px] font-medium text-accent">
              {anon ? dict.paywall.signIn : dict.paywall.seePlans}
            </a>
            <a href={anon ? `/${locale}/${PATHS.pricing[locale]}?plan=plus` : `/${locale}/${PATHS.login[locale]}`}
              className="rounded-lg border border-line px-3 py-1.5 text-[13px] font-medium text-ink-2">
              {anon ? dict.paywall.seePlans : dict.paywall.signIn}
            </a>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-4 rounded-lg border border-line bg-surface px-3 py-2.5 text-[13px] text-down">
          {error}
        </p>
      )}

      {/* Answers announce themselves once settled, without hijacking focus. */}
      <div ref={logRef} aria-live="polite" aria-busy={busy} className="mt-6 space-y-4">
        {turns.map((t, i) => (
          <div key={i} className="rounded-lg border border-line bg-surface p-4">
            <p className="text-[13px] font-medium text-ink-2">{t.question}</p>
            <p className="mt-2 whitespace-pre-wrap text-[14px] leading-relaxed text-ink">{t.answer}</p>
            <p className="mt-3 text-[11px] text-muted">
              {dict.ask.answeredAt} {stamp(t.capturedAt)}
            </p>
          </div>
        ))}
      </div>

      {!compact && <p className="mt-6 max-w-[68ch] text-[12px] leading-relaxed text-muted">{dict.ask.disclaimer}</p>}
    </div>
  );
}
