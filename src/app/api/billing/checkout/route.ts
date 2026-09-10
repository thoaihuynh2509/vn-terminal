import { NextResponse } from "next/server";
import { BRAND } from "@/lib/brand";
import { getSession } from "@/lib/auth/session";
import { sameOrigin } from "@/lib/auth/same-origin";
import { dbAvailable, getDb, DbUnavailableError } from "@/lib/db";
import { clientIp, createLimiter } from "@/lib/rate-limit";
import { isPaidTier, isPlan, priceFor } from "@/lib/billing/plans";
import { createRequestBody, momoConfig } from "@/lib/billing/momo";
import { buildPayUrl, vnpayConfig, vnpDate } from "@/lib/billing/vnpay";
import { qrImageUrl, sepayConfig } from "@/lib/billing/sepay";
import { isProvider, manualQrUrl, providerEnabled, type Provider } from "@/lib/billing/providers";
import { isLocale, PATHS } from "@/lib/i18n";

export const runtime = "nodejs";
export const revalidate = 0;

const limited = createLimiter({ windowMs: 60_000, max: 10 });

type CheckoutData =
  | { kind: "redirect"; url: string; orderId: string }
  | { kind: "qr"; imageUrl: string; orderId: string; amount?: number; note?: string; manual?: boolean };

/**
 * Start a payment for a tier upgrade with the chosen provider.
 *
 * The order is written `pending` BEFORE any provider is contacted, so every
 * callback has a row to reconcile. Nothing here grants a tier — the provider's
 * IPN/return/webhook does, because a channel the reader controls must never be
 * trusted for money. Redirect providers return a `url`; SePay returns a QR to
 * scan and the reader is settled by webhook while the page polls the order.
 */
export async function POST(req: Request) {
  // A forged cross-site POST would write orders against a signed-in reader and
  // spend calls at the gateway on their behalf.
  if (!sameOrigin(req)) {
    return NextResponse.json({ ok: false, error: "cross_site" }, { status: 403 });
  }

  const session = await getSession();
  if (!session?.email) {
    return NextResponse.json({ ok: false, error: "sign_in_required" }, { status: 401 });
  }

  const site = process.env.NEXT_PUBLIC_SITE_URL;
  if (!site || !dbAvailable()) {
    return NextResponse.json({ ok: false, error: "billing_not_configured" }, { status: 501 });
  }

  if (limited(clientIp(req))) {
    return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429, headers: { "Retry-After": "60" } });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 400 });
  }

  const { tier, plan, provider: rawProvider, locale: rawLocale } = (body ?? {}) as {
    tier?: unknown;
    plan?: unknown;
    provider?: unknown;
    locale?: unknown;
  };
  if (!isPaidTier(tier) || !isPlan(plan)) {
    return NextResponse.json({ ok: false, error: "invalid_plan" }, { status: 400 });
  }
  const provider: Provider = isProvider(rawProvider) ? rawProvider : "momo";
  if (!providerEnabled(provider)) {
    return NextResponse.json({ ok: false, error: "provider_not_configured" }, { status: 501 });
  }
  const locale = typeof rawLocale === "string" && isLocale(rawLocale) ? rawLocale : "vi";
  const amount = priceFor(tier, plan).amount;
  const orderId = `vnt-${crypto.randomUUID()}`;
  const returnUrl = `${site}/${locale}/${PATHS.pricing[locale]}?order=${orderId}`;

  try {
    const db = await getDb();
    await db.orders.create({ id: orderId, email: session.email, tier, plan, amount, provider }, new Date());

    let data: CheckoutData;
    if (provider === "momo") {
      const cfg = momoConfig()!;
      const payload = createRequestBody(cfg, {
        amount,
        orderId,
        requestId: crypto.randomUUID(),
        orderInfo: `${BRAND.name} ${tier} · ${plan}`,
        redirectUrl: returnUrl,
        ipnUrl: `${site}/api/billing/momo/ipn`,
      });
      const res = await fetch(cfg.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = (await res.json()) as { resultCode?: number; payUrl?: string; message?: string };
      if (j.resultCode !== 0 || !j.payUrl) {
        return NextResponse.json({ ok: false, error: "provider_declined", detail: j.message ?? null }, { status: 502 });
      }
      data = { kind: "redirect", url: j.payUrl, orderId };
    } else if (provider === "vnpay") {
      const url = buildPayUrl(vnpayConfig()!, {
        amount,
        txnRef: orderId,
        orderInfo: `${BRAND.name} ${tier} ${plan}`,
        returnUrl,
        ipAddr: clientIp(req),
        createDate: vnpDate(new Date()),
      });
      data = { kind: "redirect", url, orderId };
    } else if (provider === "sepay") {
      data = { kind: "qr", imageUrl: qrImageUrl(sepayConfig()!, orderId, amount), orderId };
    } else {
      // Manual: show the owner's static QR; a human confirms in /admin. The short
      // note lets the payer tag the transfer so the owner can match it.
      data = { kind: "qr", imageUrl: manualQrUrl()!, orderId, amount, note: orderId.slice(-6).toUpperCase(), manual: true };
    }

    return NextResponse.json({ ok: true, data }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (err) {
    if (err instanceof DbUnavailableError) {
      return NextResponse.json({ ok: false, error: "billing_not_configured" }, { status: 501 });
    }
    throw err;
  }
}
