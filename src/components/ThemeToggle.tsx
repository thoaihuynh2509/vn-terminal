"use client";

import { useSyncExternalStore } from "react";
import { useStored, writeStored } from "@/lib/browser-store";

/** Subscribe to the OS colour-scheme so an unset preference tracks the system. */
function useOsPrefersDark(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia("(prefers-color-scheme: dark)").matches,
    () => false, // server render assumes light; the pre-paint script corrects it
  );
}

/**
 * A two-state toggle over three-state storage.
 *
 * Storage still has an unset ("follow the OS") state, but the BUTTON always
 * flips what the reader is currently looking at. An earlier version cycled
 * light → dark → system, which meant a reader on a dark OS pressed it once and
 * got light — the control appeared to do nothing on the first press.
 */
export function ThemeToggle({ label }: { label: string }) {
  const stored = useStored("theme");
  const osDark = useOsPrefersDark();
  const effective: "light" | "dark" =
    stored === "dark" || stored === "light" ? stored : osDark ? "dark" : "light";
  const next = effective === "dark" ? "light" : "dark";

  function apply() {
    writeStored("theme", next);
    document.documentElement.setAttribute("data-theme", next);
  }

  return (
    <button
      type="button"
      onClick={apply}
      aria-label={`${label} — ${next}`}
      title={`${label} — ${next}`}
      className="grid h-8 w-8 place-items-center rounded border border-line text-ink-2 hover:bg-surface-2 hover:text-ink"
    >
      {/* Shows the CURRENT theme; pressing moves to the other one. */}
      <span aria-hidden="true" className="text-sm leading-none">{effective === "dark" ? "☾" : "☀"}</span>
    </button>
  );
}
