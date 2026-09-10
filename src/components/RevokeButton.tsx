"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Admin-only: take back an order confirmed by mistake. POSTs to the admin-gated
 * revoke route, then refreshes the table.
 *
 * TWO-STEP rather than one click: there is no undo of this undo, and the button
 * sits inline in a table row where a mis-click is easy. The first click arms and
 * relabels, the second fires — a control that says what it is about to do,
 * instead of a native confirm() the page cannot style or test.
 */
export function RevokeButton({ orderId, label, armLabel, busyLabel, failLabel }: {
  orderId: string; label: string; armLabel: string; busyLabel: string; failLabel: string;
}) {
  const router = useRouter();
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);

  async function revoke() {
    if (busy) return;
    if (!armed) {
      setArmed(true);
      return;
    }
    setBusy(true);
    setErr(false);
    try {
      const res = await fetch("/api/billing/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId }),
      });
      if (!res.ok) throw new Error();
      router.refresh();
    } catch {
      setErr(true);
    } finally {
      setBusy(false);
      setArmed(false);
    }
  }

  return (
    <button
      type="button"
      onClick={revoke}
      disabled={busy}
      className="rounded border border-down px-2 py-1 text-[12px] font-medium text-down disabled:opacity-60"
    >
      {busy ? busyLabel : err ? failLabel : armed ? armLabel : label}
    </button>
  );
}
