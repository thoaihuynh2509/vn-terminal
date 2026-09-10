"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PATHS, type Dict } from "@/lib/i18n";
import type { Locale, Tier } from "@/lib/types";

/**
 * Header account control. The tier shown here is decorative — it comes from the
 * server-verified session, but nothing is gated on this value; every gate is
 * re-checked server-side on the request that matters.
 */
export function AccountMenu({
  dict,
  locale,
  email,
  tier,
}: {
  dict: Dict;
  locale: Locale;
  email: string | null;
  tier: Tier;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  if (!email) {
    return (
      <Link
        href={`/${locale}/${PATHS.login[locale]}`}
        className="rounded-lg border border-line px-2.5 py-1 text-[12px] font-medium text-ink-2 hover:bg-surface-2 hover:text-ink"
      >
        {dict.auth.signIn}
      </Link>
    );
  }

  async function signOut() {
    setBusy(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-1.5">
      <span
        title={`${dict.auth.signedInAs} ${email}`}
        className="hidden rounded-lg bg-page px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-ink-2 sm:inline"
      >
        {tier}
      </span>
      <button
        type="button"
        onClick={signOut}
        disabled={busy}
        className="rounded-lg border border-line px-2.5 py-1 text-[12px] font-medium text-ink-2 hover:bg-surface-2 hover:text-ink disabled:opacity-50"
      >
        {dict.auth.signOut}
      </button>
    </div>
  );
}
