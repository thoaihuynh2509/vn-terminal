import { PageHeader } from "@/components/editorial";
import { PlanCards } from "@/components/PlanCards";
import { ALERT_LIMIT, DRAWING_LIMIT, INDICATOR_LIMIT, can } from "@/lib/auth/entitlement";
import { COMPARE_LIMIT } from "@/lib/chart/compare";
import { anyProviderEnabled, enabledProviders } from "@/lib/billing/providers";
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
export async function PricingView({ locale }: { locale: Locale }) {
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
    { label: dict.pricing.fSync, values: TIERS.map((t) => can(t, "sync:docs")) },
  ];

  return (
    <>
      <PageHeader title={dict.pricing.title} subtitle={dict.pricing.subtitle} />

      {!enabled && (
        <div role="status" className="mb-6 rounded-lg border border-line bg-surface-2 px-4 py-3.5">
          <p className="text-[13px] font-medium text-ink">{dict.pricing.notice}</p>
        </div>
      )}

      <PlanCards
        dict={dict}
        locale={locale}
        tier={session?.tier ?? "anon"}
        signedIn={!!session?.email}
        providers={enabledProviders()}
        referralCode={referralCode}
      />

      <h2 className="mb-3 mt-8 text-[15px] font-semibold tracking-tight">{dict.pricing.featuresTitle}</h2>
      <div className="card relative overflow-x-auto">
        <table className="data-table w-full text-[13px]">
          <caption className="sr-only">{dict.pricing.featuresTitle}</caption>
          <thead className="border-b border-line bg-surface-2 text-[11px] uppercase tracking-wide text-muted">
            <tr>
              <th scope="col" className="px-3 py-2 text-left font-medium" />
              <th scope="col" className="px-3 py-2 text-center font-medium">{dict.pricing.free}</th>
              <th scope="col" className="px-3 py-2 text-center font-medium">{dict.pricing.plus}</th>
              <th scope="col" className="px-3 py-2 text-center font-medium">{dict.pricing.pro}</th>
            </tr>
          </thead>
          <tbody>
            {features.map((f) => (
              <tr key={f.label} className="border-b border-line last:border-0">
                <th scope="row" className="px-3 py-2 text-left font-medium">{f.label}</th>
                {f.values.map((v, i) => (
                  <td key={i} className="tnum px-3 py-2 text-center">
                    {typeof v === "string" ? v : v ? "✓" : "–"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
