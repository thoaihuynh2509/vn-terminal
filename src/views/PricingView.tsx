import { PageHeader } from "@/components/editorial";
import { Card } from "@/components/ui";
import { PlanCards } from "@/components/PlanCards";
import { ALERT_LIMIT, DRAWING_LIMIT, INDICATOR_LIMIT, LAYOUT_LIMIT, can } from "@/lib/auth/entitlement";
import { COMPARE_LIMIT } from "@/lib/chart/compare";
import { anyProviderEnabled, enabledProviders } from "@/lib/billing/providers";
import type { PaidTier } from "@/lib/billing/plans";
import { getSession } from "@/lib/auth/session";
import { dbAvailable, getDb } from "@/lib/db";
import { getDict } from "@/lib/i18n";
import type { Locale } from "@/lib/types";

/**
 * Prices come from `src/lib/billing/plans.ts`; the tier column comes from the
 * entitlement model, so the page can never advertise a feature the server does
 * not actually grant. When billing is not configured the CTAs fall back to
 * "coming soon" — the same fail-closed behaviour as auth — and a notice says so.
 */
export async function PricingView({
  locale,
  highlight = null,
}: {
  locale: Locale;
  /** The tier the reader was sent here to buy, from `?plan=`. */
  highlight?: PaidTier | null;
}) {
  const dict = getDict(locale);
  const session = await getSession();
  const enabled = anyProviderEnabled();

  // The reader's own referral code, to share. Read only when signed in.
  let referralCode: string | null = null;
  if (session?.email && dbAvailable()) {
    try {
      referralCode = (await (await getDb()).users.findByEmail(session.email))?.referralCode ?? null;
    } catch {
      // A DB hiccup must not take down the pricing page; the share link is a nicety.
      referralCode = null;
    }
  }

  const TIERS = ["free", "plus", "pro"] as const;
  const features: { label: string; values: (string | boolean)[] }[] = [
    { label: dict.pricing.fCharts, values: TIERS.map((t) => can(t, "chart:basic")) },
    // Intraday is enforced in three places (the bars API, the timeframe picker
    // and the server-side downgrade) but was missing from the matrix, so the one
    // gate a reader is most likely to hit was also the one we never advertised.
    { label: dict.pricing.fIntraday, values: TIERS.map((t) => can(t, "chart:intraday")) },
    { label: dict.pricing.fIndicators, values: TIERS.map((t) => String(INDICATOR_LIMIT[t])) },
    { label: dict.pricing.fLibrary, values: TIERS.map((t) => can(t, "chart:indicators")) },
    { label: dict.pricing.fWatchlist, values: TIERS.map((t) => can(t, "save:watchlist")) },
    // A count, not a tick: comparing is no longer one hardcoded index, so the
    // row has to say how many overlays a tier actually gets.
    { label: dict.pricing.fCompare, values: TIERS.map((t) => (COMPARE_LIMIT[t] ? String(COMPARE_LIMIT[t]) : false)) },
    { label: dict.pricing.fAi, values: TIERS.map((t) => can(t, "use:ai-assistant")) },
    // Drawings and alerts are rendered as COUNTS, not ticks. Free now holds both
    // capabilities, so `can()` would print "✓ ✓ ✓" across the row and hide the
    // thing actually being sold — depth, delivery and portability, which are the
    // three rows that follow.
    { label: dict.pricing.fAlerts, values: TIERS.map((t) => (ALERT_LIMIT[t] ? String(ALERT_LIMIT[t]) : false)) },
    { label: dict.pricing.fAlertEmail, values: TIERS.map((t) => can(t, "alerts:email")) },
    { label: dict.pricing.fMulti, values: TIERS.map((t) => can(t, "chart:multi")) },
    { label: dict.pricing.fDrawings, values: TIERS.map((t) => String(DRAWING_LIMIT[t])) },
    // A count for the same reason: layouts and indicator templates share one
    // budget, so the matrix states the single number the server enforces.
    { label: dict.pricing.fLayouts, values: TIERS.map((t) => String(LAYOUT_LIMIT[t])) },
    { label: dict.pricing.fSync, values: TIERS.map((t) => can(t, "sync:docs")) },
  ];

  return (
    <>
      <PageHeader
        title={dict.pricing.title}
        subtitle={dict.pricing.subtitle}
        size="hero"
        align="center"
      />

      {!enabled && (
        <div role="status" className="mx-auto mb-7 max-w-[68ch] rounded-[14px] border border-dashed border-gold-line bg-gold-soft px-5 py-4 text-center">
          <p className="text-[14px] leading-relaxed text-ink">{dict.pricing.notice}</p>
        </div>
      )}

      <PlanCards
        dict={dict}
        locale={locale}
        tier={session?.tier ?? "anon"}
        signedIn={!!session?.email}
        providers={enabledProviders()}
        referralCode={referralCode}
        highlight={highlight}
      />

      <section className="mt-12">
        <h2 className="mb-4 text-[22px] font-semibold tracking-tight">{dict.pricing.featuresTitle}</h2>
        <div className="card relative overflow-x-auto overflow-y-hidden">
          <table className="data-table w-full min-w-[600px] text-[14px]">
            <caption className="sr-only">{dict.pricing.featuresTitle}</caption>
            <thead className="border-b border-line bg-surface-2 font-mono text-[11px] uppercase tracking-[0.1em] text-muted">
              <tr>
                <th scope="col" className="px-5 py-3 text-left font-medium" />
                {TIERS.map((t) => (
                  <th
                    key={t}
                    scope="col"
                    // Colour alone cannot carry the highlight: it is invisible in
                    // greyscale and silent to a screen reader, which is exactly
                    // the reader who cannot see which column the URL picked.
                    aria-current={t === highlight ? "true" : undefined}
                    className={`w-[150px] px-3 py-3 text-center font-medium ${
                      t === highlight ? "text-accent underline underline-offset-4" : t === "plus" ? "text-accent" : ""
                    }`}
                  >
                    {dict.pricing[t]}
                    {t === highlight && <span className="sr-only"> — {dict.pricing.recommended}</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {features.map((f) => (
                <tr key={f.label} className="border-b border-line last:border-0">
                  <th scope="row" className="px-5 py-3 text-left font-normal">{f.label}</th>
                  {f.values.map((v, i) => (
                    <td
                      key={i}
                      className={`tnum px-3 py-3 text-center font-mono ${
                        TIERS[i] === highlight ? "bg-gold-soft font-semibold text-ink" : TIERS[i] === "plus" ? "font-medium" : "text-ink-2"
                      }`}
                    >
                      {typeof v === "string" ? v : v ? "✓" : "–"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* What the reader can actually pay with, straight from the providers
          that are configured — never a logo wall of gateways we do not accept. */}
      {enabled && (
        <Card className="mt-7 p-6">
          <h2 className="text-[18px] font-semibold tracking-tight">{dict.pricing.payMethod}</h2>
          <ul className="mt-4 flex flex-wrap gap-2.5">
            {enabledProviders().map((p) => (
              <li key={p} className="rounded-[10px] border border-line px-3.5 py-2.5 text-[13px] text-ink-2">
                {({ momo: dict.pricing.mMomo, vnpay: dict.pricing.mVnpay, sepay: dict.pricing.mSepay, manual: dict.pricing.mManual })[p]}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
