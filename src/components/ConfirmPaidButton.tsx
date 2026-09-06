"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Admin-only: mark a pending order paid after checking the transfer by hand.
 * POSTs to the admin-gated confirm route, then refreshes the table. Idempotent
 * on the server, so a double-click cannot double-grant.
 */
export function ConfirmPaidButton({ orderId, label, busyLabel, failLabel }: {
  orderId: string; label: string; busyLabel: string; failLabel: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);

  async function confirm() {
    if (busy) return;
    setBusy(true);
    setErr(false);
    try {
      const res = await fetch("/api/billing/confirm", {
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
    }
  }

  return (
    <button
      type="button"
      onClick={confirm}
      disabled={busy}
      className={`rounded border px-2 py-1 text-[12px] font-medium disabled:opacity-60 ${
        err ? "border-down text-down" : "border-accent bg-accent text-page hover:opacity-90"
      }`}
    >
      {busy ? busyLabel : err ? failLabel : label}
    </button>
  );
}
