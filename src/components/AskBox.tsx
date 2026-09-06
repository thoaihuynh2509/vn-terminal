"use client";

import { useRef, useState } from "react";
import { getDict } from "@/lib/i18n";
import type { Locale } from "@/lib/types";
import { track } from "@/lib/analytics/posthog";

interface Turn {
  question: string;
  answer: string;
  capturedAt: string;
}

const SUGGESTIONS: Record<Locale, string[]> = {
  vi: ["Mã nào tăng mạnh nhất phiên này?", "Giá vàng SJC hôm nay bao nhiêu?", "VNINDEX đang ở mức nào?", "Giá Bitcoin hiện tại?"],
  en: ["Which stocks gained most this session?", "What is the SJC gold price?", "Where is the VNINDEX?", "What is Bitcoin trading at?"],
};

const SYMBOL_SUGGESTIONS: Record<Locale, string[]> = {
  vi: ["{sym} đóng cửa ở đâu so với hôm qua?", "Khối lượng {sym} phiên này?", "{sym} đã đi thế nào trong tháng qua?"],
  en: ["Where did {sym} close versus yesterday?", "What was {sym}'s volume today?", "How has {sym} moved over the past month?"],
};

export function AskBox({ locale, isMock, symbol, compact = false }: {
  locale: Locale; isMock: boolean;
  /** Symbol on screen — attached to the snapshot the model answers from. */
  symbol?: string;
  compact?: boolean;
}) {
  const dict = getDict(locale);
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [freeLeft, setFreeLeft] = useState<number | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

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
      if (typeof json.data.freeRemaining === "number") setFreeLeft(json.data.freeRemaining);
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
        <p role="note" className="mb-4 rounded border border-line bg-surface px-3 py-2.5 text-[12px] text-ink-2">
          {dict.ask.mockNotice}
        </p>
      )}

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
          className="min-w-0 flex-1 rounded border border-line bg-surface px-3 py-2 text-[14px] text-ink placeholder:text-muted disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={busy || !question.trim()}
          className="rounded border border-line bg-surface-2 px-4 py-2 text-[13px] font-medium text-ink disabled:opacity-50"
        >
          {busy ? dict.ask.sending : dict.ask.send}
        </button>
        {turns.length > 0 && (
          <button
            type="button"
            onClick={() => { setTurns([]); setError(null); }}
            className="rounded border border-line px-3 py-2 text-[13px] text-ink-2 hover:text-ink"
          >
            {dict.ask.clear}
          </button>
        )}
      </form>

      {freeLeft !== null && !locked && (
        <p role="status" className="mt-2.5 text-[12px] text-muted">
          {freeLeft > 0 ? dict.ask.freeLeft.replace("{n}", String(freeLeft)) : dict.ask.freeNone}
        </p>
      )}

      {turns.length === 0 && (
        <div className="mt-4">
          <p className="text-[12px] font-medium uppercase tracking-wide text-muted">{dict.ask.suggestions}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {(symbol ? SYMBOL_SUGGESTIONS[locale].map((t) => t.replace("{sym}", symbol)) : SUGGESTIONS[locale]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => submit(s)}
                disabled={busy}
                className="rounded border border-line px-2.5 py-1.5 text-[12px] text-ink-2 hover:bg-surface-2 hover:text-ink disabled:opacity-50"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {locked && (
        <div role="status" className="mt-4 card p-4 text-center">
          <p className="text-[13px] font-medium">{dict.paywall.aiLocked}</p>
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            <a href={`/${locale}/${locale === "vi" ? "dang-nhap" : "login"}`} className="rounded border border-line bg-surface-2 px-3 py-1.5 text-[13px] font-medium">
              {dict.paywall.signIn}
            </a>
            <a href={`/${locale}/${locale === "vi" ? "goi-dich-vu" : "pricing"}`} className="rounded border border-line px-3 py-1.5 text-[13px] font-medium text-accent">
              {dict.paywall.seePlans}
            </a>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-4 rounded border border-line bg-surface px-3 py-2.5 text-[13px] text-down">
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
