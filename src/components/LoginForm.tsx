"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { AuthProvider } from "@/lib/auth/provider";
import type { Dict } from "@/lib/i18n";
import type { Locale, Tier } from "@/lib/types";
import { track } from "@/lib/analytics/posthog";

/**
 * Passwordless sign-in form.
 *
 * There is no password field on purpose — this codebase never accepts, hashes
 * or stores a password. `magic` mails a single-use link; `dev` signs in on the
 * spot and its tier selector exists only so every paywall branch is reachable
 * without a billing system. With a real provider the tier comes from the
 * account record, not the form.
 */
export function LoginForm({
  dict,
  locale,
  provider,
  next,
}: {
  dict: Dict;
  locale: Locale;
  provider: AuthProvider;
  next?: string;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  // Dev-mode convenience: Pro is preselected so local testing of the paid
  // surface is one click. The dev provider never runs in production.
  const [tier, setTier] = useState<Tier>("pro");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    track("signin_started", { provider });
    const magic = provider === "magic";
    try {
      const res = await fetch(magic ? "/api/auth/magic/request" : "/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(magic ? { email, locale, next } : { email, tier }),
      });
      if (res.status === 429) return setError(dict.auth.tooMany);
      if (res.status === 400) return setError(dict.auth.emailInvalid);
      if (res.status === 501) return setError(dict.auth.disabled);
      if (!res.ok) return setError(dict.auth.failed);
      if (magic) return setSent(true); // the link goes to the inbox, never to this response
      router.push(next ?? `/${locale}`);
      router.refresh(); // pick up the new session in server components
    } catch {
      setError(dict.auth.failed);
    } finally {
      setBusy(false);
    }
  }

  if (provider === "disabled") {
    return (
      <p role="status" className="card p-4 text-[13px] text-ink-2">
        {dict.auth.disabled}
      </p>
    );
  }

  if (sent) {
    return (
      <div role="status" className="card p-5">
        <p className="text-[14px] font-semibold text-ink">{dict.auth.linkSent}</p>
        <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">{dict.auth.linkSentBody}</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="card p-5">
      <label htmlFor="login-email" className="block text-[12px] font-medium text-ink-2">
        {dict.auth.email}
      </label>
      <input
        id="login-email"
        type="email"
        required
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="mt-1.5 w-full rounded border border-line bg-surface px-3 py-2 text-[14px] text-ink placeholder:text-muted"
        placeholder={dict.auth.emailPlaceholder}
      />

      {provider === "dev" && (
        <fieldset className="mt-4">
          <legend className="text-[12px] font-medium text-ink-2">{dict.auth.devTier}</legend>
          <div className="mt-1.5 flex gap-1.5">
            {(["free", "plus", "pro"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTier(t)}
                aria-pressed={tier === t}
                className={`rounded border px-3 py-1.5 text-[12px] font-medium capitalize ${
                  tier === t ? "border-accent bg-surface-2 text-ink" : "border-line text-ink-2 hover:text-ink"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </fieldset>
      )}

      {error && (
        <p role="alert" className="mt-3 text-[13px] text-down">{error}</p>
      )}

      <button
        type="submit"
        disabled={busy || !email}
        className="mt-5 w-full rounded border border-line bg-surface-2 px-3 py-2 text-[13px] font-medium text-ink disabled:opacity-50"
      >
        {busy ? dict.auth.signingIn : dict.auth.submit}
      </button>
    </form>
  );
}
