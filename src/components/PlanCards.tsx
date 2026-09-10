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

  /**
   * Card treatment per tier. Plus is the featured card — gold rule and a lift
   * — and Pro is the chrome one, which needs its own text pair because
   * --ink-2 and --accent are both unreadable on that ground.
   */
  const cards = [
    { key: "free" as const, name: dict.pricing.free, desc: dict.pricing.freeDesc },
    { key: "plus" as const, name: dict.pricing.plus, desc: dict.pricing.plusDesc },
    { key: "pro" as const, name: dict.pricing.pro, desc: dict.pricing.proDesc },
  ];

  const SKIN = {
    free: { shell: "card", name: "text-muted", body: "text-ink-2", unit: "text-muted" },
    plus: { shell: "card card-raised card-featured", name: "text-accent", body: "text-ink-2", unit: "text-muted" },
    pro: { shell: "rounded-[16px] bg-chrome text-chrome-ink", name: "text-gold", body: "text-chrome-ink-2", unit: "text-chrome-ink-2" },
  } as const;

  /** Segmented control — billing cadence and payment method share it. */
  function segment<T extends string>(opts: { value: T; label: string }[], value: T, set: (v: T) => void, label: string) {
    return (
      <div className="inline-flex rounded-full border border-line bg-surface p-1" role="group" aria-label={label}>
        {opts.map((o) => (
          <button
            key={o.value}
            type="button"
            aria-pressed={value === o.value}
            onClick={() => set(o.value)}
            className={`rounded-full px-4 py-2 text-[13px] font-medium transition-colors ${
              value === o.value ? "bg-btn font-semibold text-btn-ink" : "text-muted hover:text-ink"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    );
  }

  return (
    <>
      {order !== "idle" && (
        <div role="status" className="mb-6 rounded-[14px] border border-line bg-surface px-5 py-4 text-[14px] text-ink">
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
        <Card className="mb-6 flex flex-col items-center p-6 text-center">
          <h2 className="text-[17px] font-semibold tracking-tight">{dict.pricing.qrTitle}</h2>
          <Image
            src={qr}
            alt={dict.pricing.qrTitle}
            width={220}
            height={220}
            unoptimized
            className="my-4 rounded-xl"
          />
          {(qrInfo.amount !== undefined || qrInfo.note) && (
            <div className="mb-2.5 text-[13px]">
              {qrInfo.amount !== undefined && (
                <div><span className="text-muted">{dict.pricing.qrAmount}: </span><span className="tnum font-mono font-semibold">{vnd(qrInfo.amount, locale)}</span></div>
              )}
              {qrInfo.note && (
                <div><span className="text-muted">{dict.pricing.qrNote}: </span><span className="tnum font-mono font-semibold">{qrInfo.note}</span></div>
              )}
            </div>
          )}
          <p className="max-w-[46ch] text-[13px] leading-relaxed text-muted">{qrInfo.manual ? dict.pricing.qrManualNote : dict.pricing.qrHint}</p>
        </Card>
      )}

      <div className="mb-7 flex flex-wrap items-center justify-center gap-5">
        {/* Billing cadence. Annual is preselected because it is the better value. */}
        {segment(
          [
            { value: "monthly" as Plan, label: dict.pricing.billedMonthly },
            { value: "annual" as Plan, label: dict.pricing.billedAnnually },
          ],
          plan, setPlan, dict.pricing.billedMonthly,
        )}

        {billingEnabled && providers.length > 1 && (
          <div className="inline-flex items-center gap-2.5">
            <span className="text-[13px] text-muted">{dict.pricing.payMethod}</span>
            {segment(providers.map((pr) => ({ value: pr, label: methodLabel[pr] })), method, setMethod, dict.pricing.payMethod)}
          </div>
        )}
      </div>

      {error && (
        <p role="alert" className="mb-4 text-[14px] text-down">
          {error}
        </p>
      )}

      <div className="grid items-start gap-5 lg:grid-cols-3">
        {cards.map((c) => {
          const paid = c.key !== "free";
          const price = paid ? priceFor(c.key, plan) : { amount: 0 };
          const owned = atLeast(tier, c.key);
          const saving = paid && annual ? annualSavingPct(c.key) : 0;
          // The card the reader was sent here for. Marked, not auto-purchased:
          // arriving from a ceiling is a reason to look, not consent to pay.
          const picked = c.key === highlight && !owned;
          const skin = SKIN[c.key];
          const onChrome = c.key === "pro";
          const cta = "mt-7 block rounded-[10px] px-4 py-3 text-center text-[14px] font-semibold";
          const ctaQuiet = onChrome
            ? `${cta} border border-chrome-line text-chrome-ink hover:bg-chrome-hover`
            : `${cta} border border-axis text-ink hover:border-ink`;
          const ctaLoud = onChrome
            ? `${cta} border border-chrome-line text-chrome-ink hover:bg-chrome-hover`
            : c.key === "plus"
              ? `${cta} bg-gold text-gold-ink hover:bg-gold-hover`
              : `${cta} bg-btn text-btn-ink hover:bg-btn-hover`;
          return (
            <div key={c.key} className={`relative flex flex-col p-7 ${skin.shell}`}>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className={`font-mono text-[12px] font-semibold uppercase tracking-[0.12em] ${skin.name}`}>{c.name}</h2>
                {picked && (
                  // Sits WITH the heading, not above it: readers navigating by
                  // heading land on the h2, and a badge before it is skipped.
                  // `.card` is unlayered CSS and outranks a Tailwind border
                  // utility, so the marker is a badge rather than a card border.
                  <span
                    id={`rec-${c.key}`}
                    className="rounded-full bg-gold px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-gold-ink"
                  >
                    {dict.pricing.recommended}
                  </span>
                )}
              </div>
              {/* The saving rides with the PRICE, not the heading. Beside the
                  "recommended" badge it pushed the highlighted card's heading
                  onto a second line, so that one card's price sat lower than
                  its neighbours' — visible only on the ?plan= entry path. */}
              <div className="mt-3.5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="tnum font-mono text-[34px] font-medium leading-none tracking-tight">
                  {vnd(price.amount, locale)}
                </span>
                {paid && <span className={`text-[13px] ${skin.unit}`}>{suffix}</span>}
                {saving > 0 && (
                  <span className={`font-mono text-[11px] font-semibold uppercase tracking-[0.08em] ${onChrome ? "text-chrome-up" : "text-up"}`}>
                    {dict.pricing.save.replace("{n}", String(saving))}
                  </span>
                )}
              </div>
              <p className={`mt-3.5 flex-1 text-[14px] leading-relaxed ${skin.body}`}>{c.desc}</p>

              {!paid ? (
                owned ? (
                  <span className={`${ctaQuiet} text-muted`}>{dict.pricing.currentPlan}</span>
                ) : (
                  <Link href={`/${locale}`} className={ctaQuiet}>{dict.pricing.ctaFree}</Link>
                )
              ) : owned ? (
                <span className={`${ctaQuiet} ${onChrome ? "" : "text-muted"}`}>{dict.pricing.currentPlan}</span>
              ) : !billingEnabled ? (
                <button type="button" disabled className={`${ctaQuiet} opacity-60`}>
                  {dict.pricing.comingSoon}
                </button>
              ) : !signedIn ? (
                <Link
                  href={`${href(locale, "login")}?next=${encodeURIComponent(href(locale, "pricing"))}`}
                  className={ctaLoud}
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
                  className={`${ctaLoud} disabled:opacity-60`}
                >
                  {busy === c.key ? dict.pricing.processing : dict.pricing.upgrade}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {signedIn && referralCode && (
        <Card className="mt-6 flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h2 className="text-[18px] font-semibold tracking-tight">{dict.pricing.refTitle}</h2>
            <p className="mt-2 max-w-[60ch] text-[14px] leading-relaxed text-ink-2">{dict.pricing.refBody}</p>
            <p className="mt-3 truncate rounded-[10px] border border-line bg-page px-3 py-2.5 font-mono text-[13px] text-muted">
              {`/${locale}?ref=${referralCode}`}
            </p>
          </div>
          <button
            type="button"
            onClick={copyInvite}
            className="shrink-0 rounded-[10px] bg-btn px-4 py-2.5 text-[14px] font-semibold text-btn-ink hover:bg-btn-hover"
          >
            {copied ? dict.pricing.refCopied : dict.pricing.refCopy}
          </button>
        </Card>
      )}
    </>
  );
}
