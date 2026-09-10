"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { track } from "@/lib/analytics/posthog";
import { PATHS, type Dict } from "@/lib/i18n";
import type { Locale, Tier } from "@/lib/types";

/**
 * What a reader sees when they hit a ceiling.
 *
 * Every gate already emitted `chart_limit_hit` and then did nothing visible —
 * the fourth drawing simply refused to appear, which reads as a bug rather than
 * a limit. This is the missing half: it names the ceiling, says what lifts it,
 * and gets out of the way.
 *
 * Inline and dismissible, NEVER a modal. A reader who hits a cap is in the
 * middle of doing something; a dialog would interrupt the exact work we want
 * them to keep doing, and a paywall that punishes engagement teaches people to
 * engage less. It also never blocks the basics — the chart behind it stays fully
 * usable.
 *
 * Dismissal is per gate and remembered for the session only, so a reader who
 * waves it away is not nagged, and a reader who comes back tomorrow is reminded
 * once.
 */
export type Gate = "drawing" | "indicator" | "layout" | "alert" | "compare" | "intraday" | "multi";

const DISMISSED = new Set<Gate>();

export function GateHint({
  gate, locale, dict, tier, limit, asked, onClose,
}: {
  gate: Gate;
  locale: Locale;
  dict: Dict;
  tier: Tier;
  /** The ceiling that refused, so the copy can state the actual number. */
  limit?: number;
  /**
   * The reader ASKED why something is locked, rather than tripping over a
   * ceiling mid-task. Dismissal suppresses the nag, never an answer someone
   * requested: a control that stays silent on the second press is the broken
   * tool this component was written to stop being.
   */
  asked?: boolean;
  onClose?: () => void;
}) {
  const [open, setOpen] = useState(() => asked || !DISMISSED.has(gate));

  useEffect(() => {
    if (open) track("upgrade_prompt_shown", { gate, tier, limit });
  }, [open, gate, tier, limit]);

  const close = useCallback(() => {
    DISMISSED.add(gate);
    setOpen(false);
    onClose?.();
  }, [gate, onClose]);

  if (!open) return null;

  // Anonymous readers are asked to sign in, not to pay: the next step for
  // someone with no account is an account, and a price is a strange first ask.
  const anon = tier === "anon";
  // `anon` is the only tier without `chart:drawings`, so its drawing gate is
  // not a ceiling it reached — the count-based copy would read "you have used
  // all 0 drawings". It gets the reason it is actually stopped instead.
  const body = (anon && gate === "drawing" ? dict.gate.drawingAnon : dict.gate[gate] ?? "")
    .replace("{n}", String(limit ?? ""));
  const href = anon
    ? `/${locale}/${PATHS.login[locale]}`
    : `/${locale}/${PATHS.pricing[locale]}?plan=plus`;

  return (
    <div className="mt-2 flex items-start justify-between gap-3 rounded-[10px] border border-dashed border-gold-line bg-gold-soft px-3.5 py-2.5 text-[12px]">
      <p className="min-w-0 text-ink-2">
        {body}{" "}
        <Link href={href} onClick={() => track("upgrade_prompt_clicked", { gate, tier })}
          className="font-medium text-accent hover:underline">
          {anon ? dict.auth.signIn : dict.gate.upgrade} →
        </Link>
      </p>
      <button type="button" onClick={close} aria-label={dict.gate.dismiss}
        className="shrink-0 px-1 leading-none text-muted hover:text-ink">
        <span aria-hidden="true">×</span>
      </button>
    </div>
  );
}
