"use client";

import { useEffect, useRef, useState } from "react";
import type { Dict } from "@/lib/i18n";
import type { Locale } from "@/lib/types";

/**
 * Read-aloud via the browser's built-in speech synthesis.
 *
 * Chosen over a hosted TTS API deliberately: it is free, has no per-request
 * cost, needs no key, and adds no latency — and the alternative would put a
 * metered network call behind every play button. The trade-off is voice
 * quality and that Vietnamese voices are not installed everywhere, so the
 * control hides itself when no usable voice exists rather than reading
 * Vietnamese text with an English voice, which is unintelligible.
 *
 * Only ever pointed at text we own (our own brief, our own translations).
 */
export function ReadAloud({ text, dict, locale }: { text: string; dict: Dict; locale: Locale }) {
  const [supported, setSupported] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [paused, setPaused] = useState(false);
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;

    const pick = () => {
      const wanted = locale === "vi" ? "vi" : "en";
      const voices = window.speechSynthesis.getVoices();
      const match =
        voices.find((v) => v.lang?.toLowerCase().startsWith(`${wanted}-`)) ??
        voices.find((v) => v.lang?.toLowerCase().startsWith(wanted));
      voiceRef.current = match ?? null;
      setSupported(Boolean(match));
    };

    pick();
    // Voice list loads asynchronously in most browsers.
    window.speechSynthesis.addEventListener("voiceschanged", pick);
    return () => {
      window.speechSynthesis.removeEventListener("voiceschanged", pick);
      window.speechSynthesis.cancel();
    };
  }, [locale]);

  function play() {
    if (!voiceRef.current) return;
    window.speechSynthesis.cancel();
    // Long text is chunked: several engines silently truncate a long utterance.
    const chunks = text.match(/[^.!?]+[.!?]*/g)?.map((s) => s.trim()).filter(Boolean) ?? [text];
    chunks.forEach((chunk, i) => {
      const u = new SpeechSynthesisUtterance(chunk);
      u.voice = voiceRef.current;
      u.lang = voiceRef.current!.lang;
      u.rate = 1;
      if (i === chunks.length - 1) {
        u.onend = () => { setSpeaking(false); setPaused(false); };
      }
      window.speechSynthesis.speak(u);
    });
    setSpeaking(true);
    setPaused(false);
  }

  function toggle() {
    if (!speaking) return play();
    if (paused) { window.speechSynthesis.resume(); setPaused(false); }
    else { window.speechSynthesis.pause(); setPaused(true); }
  }

  function stop() {
    window.speechSynthesis.cancel();
    setSpeaking(false);
    setPaused(false);
  }

  // No Vietnamese voice on this device — say nothing rather than read it badly.
  if (!supported) return null;

  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={toggle}
        aria-label={speaking && !paused ? dict.audio.pause : dict.audio.play}
        className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-page px-3 py-1.5 text-[12px] font-medium text-ink hover:bg-surface"
      >
        <span aria-hidden="true">{speaking && !paused ? "❚❚" : "▶"}</span>
        {speaking && !paused ? dict.audio.pause : dict.audio.play}
      </button>
      {speaking && (
        <button
          type="button"
          onClick={stop}
          aria-label={dict.audio.stop}
          className="rounded-lg border border-line px-2.5 py-1.5 text-[12px] text-ink-2 hover:text-ink"
        >
          <span aria-hidden="true">■</span>
        </button>
      )}
    </div>
  );
}
