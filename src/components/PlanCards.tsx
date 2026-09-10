"use client";

import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui";
import { atLeast, type Tier } from "@/lib/auth/entitlement";
import { annualSavingPct, priceFor, type PaidTier, type Plan } from "@/lib/billing/plans";
import type { Provider } from "@/lib/billing/providers";
import { track } from "@/lib/analytics/posthog";
import { vnd } from "@/lib/format";
import { href } from "@/lib/i18n";
import type { Dict } from "@/lib/i18n";
import type { Locale } from "@/lib/types";

type OrderState = "idle" | "processing" | "paid" | "failed";

/**
 * The pricing store: monthly/annual toggle, a payment-method picker over the
 * providers that are actually configured, real prices, and a working upgrade
 * CTA. Redirect providers (MoMo, VNPay) send the reader to a gateway; SePay
 * shows a QR and the page polls the order to completion. The IPN/webhook is
 * what grants — the UI only mirrors the server so a reader is never sent down a
 * path that only fails at the API.
 */
export function PlanCards({
  dict,
  locale,
  tier,
  signedIn,
  providers,
  referralCode,
  highlight = null,
}: {
  dict: Dict;
  locale: Locale;
  tier: Tier;
  signedIn: boolean;
  providers: Provider[];
  referralCode: string | null;
  /** The tier the reader was sent here to buy, from `?plan=`. */
  highlight?: PaidTier | null;
}) {
  const router = useRouter();
  const [plan, setPlan] = useState<Plan>("annual");
  const [method, setMethod] = useState<Provider>(providers[0] ?? "momo");
  const [busy, setBusy] = useState<Tier | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<OrderState>("idle");
  const [paidTier, setPaidTier] = useState<string>("");
  const [qr, setQr] = useState<string | null>(null);
  const [qrInfo, setQrInfo] = useState<{ amount?: number; note?: string; manual?: boolean }>({});
  const [copied, setCopied] = useState(false);
  const billingEnabled = providers.length > 0;

  // Poll one order until the IPN/webhook flips it, then re-mint the session.
  const pollOrder = useCallback(
    (id: string) => {
      let stop = false;
      let tries = 0;
      const tick = async () => {
        if (stop) return;
        if (tries === 0) setOrder("processing");
        tries += 1;
        try {
          const res = await fetch(`/api/billing/order?order=${encodeURIComponent(id)}`, { cache: "no-store" });
          const body = await res.json();
          const status = body?.data?.status;
          if (status === "paid") {
            // The purchase is reported from the settle seam on the server, which
            // is the only place that sees the owner's manual confirmation too.
            await fetch("/api/auth/refresh", { method: "POST" });
            if (stop) return;
            setPaidTier(body.data.tier === "pro" ? dict.pricing.pro : dict.pricing.plus);
            setQr(null);
            setOrder("paid");
            router.refresh();
            return;
          }
        } catch {
          /* transient; keep trying within the budget */
        }
        if (tries >= 60) setOrder("failed"); // ~2 min, room for a bank transfer
        else if (!stop) setTimeout(tick, 2000);
      };
      void tick();
      return () => {
        stop = true;
      };
    },
    [dict.pricing.plus, dict.pricing.pro, router],
  );

  // Return leg from a redirect provider: ?order= in the URL.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("order");
    if (!id) return;
    return pollOrder(id);
  }, [pollOrder]);

  async function checkout(target: "plus" | "pro") {
    if (busy) return;
    setBusy(target);
    setError(null);
    track("checkout_started", { tier: target, plan, provider: method });
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier: target, plan, provider: method, locale }),
      });
      if (res.status === 401) {
        router.push(`${href(locale, "login")}?next=${encodeURIComponent(href(locale, "pricing"))}`);
        return;
      }
      const body = await res.json();
      if (res.ok && body?.data?.kind === "redirect") {
        window.location.assign(body.data.url); // to the gateway
        return;
      }
      if (res.ok && body?.data?.kind === "qr") {
        setQr(body.data.imageUrl);
        setQrInfo({ amount: body.data.amount, note: body.data.note, manual: body.data.manual });
        pollOrder(body.data.orderId);
        return;
      }
      setError(dict.pricing.checkoutError);
    } catch {
      setError(dict.pricing.checkoutError);
    } finally {
      setBusy(null);
    }
  }

  async function copyInvite() {
    if (!referralCode) return;
    const link = `${window.location.origin}/${locale}?ref=${referralCode}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked; the link is still visible to copy by hand */
    }
  }

  const annual = plan === "annual";
  const suffix = annual ? dict.pricing.perYear : dict.pricing.monthly;
  const methodLabel: Record<Provider, string> = {
    momo: dict.pricing.mMomo,
    vnpay: dict.pricing.mVnpay,
    sepay: dict.pricing.mSepay,
    manual: dict.pricing.mManual,
  };

  const cards = [
    { key: "free" as const, name: dict.pricing.free, desc: dict.pricing.freeDesc },
    { key: "plus" as const, name: dict.pricing.plus, desc: dict.pricing.plusDesc },
    { key: "pro" as const, name: dict.pricing.pro, desc: dict.pricing.proDesc },
  ];

  return (
    <>
      {order !== "idle" && (
        <div role="status" className="mb-6 rounded-lg border border-line bg-surface-2 px-4 py-3.5 text-[13px] text-ink">
          {order === "processing" && <p className="font-medium">{dict.pricing.processing}</p>}
          {order === "paid" && (
            <p className="font-medium text-up">
              {dict.pricing.paidTitle} {dict.pricing.paidBody.replace("{tier}", paidTier)}
            </p>
          )}
          {order === "failed" && <p className="font-medium">{dict.pricing.payFailed}</p>}
        </div>
      )}

      {qr && order !== "paid" && (
        <Card className="mb-6 flex flex-col items-center p-5 text-center">
          <h2 className="text-[15px] font-semibold tracking-tight">{dict.pricing.qrTitle}</h2>
          <Image
            src={qr}
            alt={dict.pricing.qrTitle}
            width={220}
            height={220}
            unoptimized
            className="my-3 rounded"
          />
          {(qrInfo.amount !== undefined || qrInfo.note) && (
            <div className="mb-2 text-[13px]">
              {qrInfo.amount !== undefined && (
                <div><span className="text-muted">{dict.pricing.qrAmount}: </span><span className="tnum font-semibold">{vnd(qrInfo.amount, locale)}</span></div>
              )}
              {qrInfo.note && (
                <div><span className="text-muted">{dict.pricing.qrNote}: </span><span className="tnum font-semibold">{qrInfo.note}</span></div>
              )}
            </div>
          )}
          <p className="max-w-[46ch] text-[12px] text-muted">{qrInfo.manual ? dict.pricing.qrManualNote : dict.pricing.qrHint}</p>
        </Card>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-4">
        {/* Billing cadence. Annual is preselected because it is the better value. */}
        <div className="inline-flex rounded-lg border border-line bg-surface-2 p-0.5" role="group" aria-label={dict.pricing.billedMonthly}>
          {(["monthly", "annual"] as const).map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={plan === p}
              onClick={() => setPlan(p)}
              className={`rounded-md px-3 py-1.5 text-[13px] font-medium ${
                plan === p ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"
              }`}
            >
              {p === "monthly" ? dict.pricing.billedMonthly : dict.pricing.billedAnnually}
            </button>
          ))}
        </div>

        {billingEnabled && providers.length > 1 && (
          <div className="inline-flex items-center gap-2">
            <span className="text-[12px] text-muted">{dict.pricing.payMethod}</span>
            <div className="inline-flex rounded-lg border border-line bg-surface-2 p-0.5" role="group" aria-label={dict.pricing.payMethod}>
              {providers.map((p) => (
                <button
                  key={p}
                  type="button"
                  aria-pressed={method === p}
                  onClick={() => setMethod(p)}
                  className={`rounded-md px-3 py-1.5 text-[13px] font-medium ${
                    method === p ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"
                  }`}
                >
                  {methodLabel[p]}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {error && (
        <p role="alert" className="mb-4 text-[13px] text-down">
          {error}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        {cards.map((c) => {
          const paid = c.key !== "free";
          const price = paid ? priceFor(c.key, plan) : { amount: 0 };
          const owned = atLeast(tier, c.key);
          const saving = paid && annual ? annualSavingPct(c.key) : 0;
          // The card the reader was sent here for. Marked, not auto-purchased:
          // arriving from a ceiling is a reason to look, not consent to pay.
          const picked = c.key === highlight && !owned;
          return (
            <Card key={c.key} className="flex flex-col p-5">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-[11px] font-bold uppercase tracking-wider text-muted">{c.name}</h2>
                {picked && (
                  // Sits WITH the heading, not above it: readers navigating by
                  // heading land on the h2, and a badge before it is skipped.
                  // `.card` is unlayered CSS and outranks a Tailwind border
                  // utility, so the marker is a badge rather than a card border.
                  <span
                    id={`rec-${c.key}`}
                    className="rounded bg-accent px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-page"
                  >
                    {dict.pricing.recommended}
                  </span>
                )}
                {saving > 0 && (
                  <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-up">
                    {dict.pricing.save.replace("{n}", String(saving))}
                  </span>
                )}
              </div>
              <div className="mt-2 flex items-baseline gap-1.5">
                <span className="tnum text-[30px] font-semibold leading-none tracking-tight">
                  {vnd(price.amount, locale)}
                </span>
                {paid && <span className="text-[11px] text-muted">{suffix}</span>}
              </div>
              <p className="mt-3 flex-1 text-[13px] leading-relaxed text-ink-2">{c.desc}</p>

              {!paid ? (
                owned ? (
                  <span className="mt-5 rounded border border-line px-3 py-2 text-center text-[13px] font-medium text-muted">
                    {dict.pricing.currentPlan}
                  </span>
                ) : (
                  <Link
                    href={`/${locale}`}
                    className="mt-5 rounded border border-line bg-surface-2 px-3 py-2 text-center text-[13px] font-medium text-ink hover:bg-surface"
                  >
                    {dict.pricing.ctaFree}
                  </Link>
                )
              ) : owned ? (
                <span className="mt-5 rounded border border-line px-3 py-2 text-center text-[13px] font-medium text-muted">
                  {dict.pricing.currentPlan}
                </span>
              ) : !billingEnabled ? (
                <button
                  type="button"
                  disabled
                  className="mt-5 rounded border border-line px-3 py-2 text-[13px] font-medium text-muted opacity-70"
                >
                  {dict.pricing.comingSoon}
                </button>
              ) : !signedIn ? (
                <Link
                  href={`${href(locale, "login")}?next=${encodeURIComponent(href(locale, "pricing"))}`}
                  className="mt-5 rounded border border-line bg-surface-2 px-3 py-2 text-center text-[13px] font-medium text-ink hover:bg-surface"
                >
                  {dict.pricing.signInToUpgrade}
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={() => checkout(c.key)}
                  disabled={busy !== null}
                  // Otherwise every card's CTA announces identically and the
                  // recommendation is lost to anyone tabbing straight to it.
                  aria-describedby={picked ? `rec-${c.key}` : undefined}
                  className="mt-5 rounded border border-accent bg-accent px-3 py-2 text-[13px] font-semibold text-page hover:opacity-90 disabled:opacity-60"
                >
                  {busy === c.key ? dict.pricing.processing : dict.pricing.upgrade}
                </button>
              )}
            </Card>
          );
        })}
      </div>

      {signedIn && referralCode && (
        <Card className="mt-6 flex flex-col gap-2 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-[15px] font-semibold tracking-tight">{dict.pricing.refTitle}</h2>
            <p className="mt-1 max-w-[60ch] text-[13px] text-ink-2">{dict.pricing.refBody}</p>
            <p className="mt-2 break-all text-[12px] text-muted">
              {`/${locale}?ref=${referralCode}`}
            </p>
          </div>
          <button
            type="button"
            onClick={copyInvite}
            className="shrink-0 rounded border border-line bg-surface-2 px-3 py-2 text-[13px] font-medium text-ink hover:bg-surface"
          >
            {copied ? dict.pricing.refCopied : dict.pricing.refCopy}
          </button>
        </Card>
      )}
    </>
  );
}
