"use client";

import { useRouter } from "next/navigation";
import { PATHS } from "@/lib/i18n";
import type { Locale } from "@/lib/types";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui";
import { readWatchlist, readWatchlistOwner, toggleWatch } from "@/components/WatchButton";
import { writeStored } from "@/lib/browser-store";
import { track } from "@/lib/analytics/posthog";
import type { Dict } from "@/lib/i18n";

/** Set once, so the chart can nudge a first-time reader exactly one time. */
export const FIRST_CHART_KEY = "hint:first-chart";

const DONE_KEY = "vnt_onboarded";

/** localStorage can throw (private mode, blocked); a market page must still render. */
function dismissed(): boolean {
  try {
    return localStorage.getItem(DONE_KEY) === "1";
  } catch {
    return false;
  }
}

/** The recognisable VN30 names a first-timer will know — enough to pick from, not a wall. */
const PICKS = ["VIC", "VNM", "FPT", "HPG", "VCB", "MWG", "VHM", "TCB", "MBB", "SSI"];

/**
 * First-visit watchlist picker — the activation moment.
 *
 * Shows once to a signed-out visitor with an empty watchlist: pick a few names,
 * and the retention loop starts on their very first session (localStorage now,
 * synced when they sign in). Renders null on the server and until it decides on
 * the client, so there is no hydration flash; dismissal is remembered so it
 * never nags. Signed-in readers already have the account loop and are skipped.
 */
export function OnboardingWatchlist({ dict, locale }: { dict: Dict; locale: Locale }) {
  const router = useRouter();
  const [show, setShow] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);

  useEffect(() => {
    const eligible = readWatchlist().length === 0 && !dismissed() && !readWatchlistOwner();
    if (!eligible) return;
    // Deferred out of the effect body (next frame) to satisfy react-hooks, and so
    // the first paint stays the SSR null — no onboarding flash for a return visitor.
    const id = requestAnimationFrame(() => setShow(true));
    return () => cancelAnimationFrame(id);
  }, []);

  if (!show) return null;

  const dismiss = () => {
    writeStored(DONE_KEY, "1");
    setShow(false);
  };
  const toggle = (s: string) => setPicked((p) => (p.includes(s) ? p.filter((x) => x !== s) : [...p, s]));
  const add = () => {
    picked.forEach(toggleWatch); // reuses the same store + sync + per-symbol event
    track("onboarding_completed", { count: picked.length });
    dismiss();
    // Land on the chart of the first symbol they picked, not back on the board.
    // Picking a watchlist is a statement of interest; the next useful thing is
    // looking at one of them, and a reader left on the page they started from
    // has to work out for themselves what they just achieved.
    const first = picked[0];
    if (first) {
      writeStored(FIRST_CHART_KEY, "1");
      router.push(`/${locale}/${PATHS.terminal[locale]}/${first}`);
    }
  };
  const skip = () => {
    track("onboarding_skipped", {});
    dismiss();
  };

  return (
    <Card className="mb-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-[16px] font-semibold tracking-tight">{dict.home.onboardTitle}</h2>
          <p className="mt-1 max-w-[64ch] text-[13px] leading-relaxed text-ink-2">{dict.home.onboardSub}</p>
        </div>
        <button type="button" onClick={skip} className="shrink-0 text-[12px] font-medium text-muted hover:text-ink">
          {dict.home.onboardSkip}
        </button>
      </div>

      <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label={dict.home.onboardTitle}>
        {PICKS.map((s) => {
          const on = picked.includes(s);
          return (
            <button
              key={s}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(s)}
              className={`tnum rounded-full border px-3 py-1.5 text-[13px] font-medium ${
                on ? "border-accent bg-accent text-page" : "border-line bg-page text-ink hover:bg-surface"
              }`}
            >
              {on ? "✓ " : ""}{s}
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={add}
        disabled={picked.length === 0}
        className="mt-4 rounded-lg border border-accent bg-accent px-3.5 py-2 text-[13px] font-semibold text-page hover:opacity-90 disabled:opacity-50"
      >
        {dict.home.onboardAdd}{picked.length ? ` (${picked.length})` : ""}
      </button>
    </Card>
  );
}
