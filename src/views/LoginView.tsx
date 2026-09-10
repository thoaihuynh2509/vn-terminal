import { LoginForm } from "@/components/LoginForm";
import { PageHeader } from "@/components/editorial";
import { Card, Eyebrow } from "@/components/ui";
import { ALERT_LIMIT, INDICATOR_LIMIT } from "@/lib/auth/entitlement";
import { activeAuthProvider } from "@/lib/auth/provider";
import { safeRedirect } from "@/lib/auth/magic";
import { getDict, PATHS } from "@/lib/i18n";
import type { Locale } from "@/lib/types";
import Link from "next/link";

export function LoginView({ locale, next, error }: { locale: Locale; next?: string; error?: string }) {
  const dict = getDict(locale);
  const provider = activeAuthProvider();
  const notice = provider === "dev" ? dict.auth.devNotice : provider === "magic" ? dict.auth.magicNotice : null;

  // What signing in actually buys, with the numbers taken from the entitlement
  // model rather than typed here — a free account that grants three alerts must
  // never be advertised as granting five.
  const benefits: { title: string; body: string }[] = [
    { title: dict.pricing.fWatchlist, body: dict.home.saveBody },
    { title: dict.pricing.fAlerts, body: `${dict.pricing.free}: ${ALERT_LIMIT.free}` },
    { title: dict.pricing.fIndicators, body: `${dict.pricing.free}: ${INDICATOR_LIMIT.free}` },
  ];

  return (
    <div className="mx-auto grid max-w-[1160px] items-center gap-12 py-6 lg:grid-cols-[minmax(0,1fr)_460px] lg:gap-14">
      <div>
        <PageHeader title={dict.auth.title} subtitle={dict.auth.subtitle} size="hero" />
        <ul className="flex flex-col gap-5">
          {benefits.map((b) => (
            <li key={b.title} className="flex gap-3.5">
              <span
                aria-hidden="true"
                className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-line bg-surface text-[13px] text-accent"
              >
                ✓
              </span>
              <div>
                <p className="text-[15px] font-medium">{b.title}</p>
                <p className="mt-1 max-w-[52ch] text-[14px] leading-relaxed text-muted">{b.body}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <Card className="card-raised p-8">
          {error === "link_invalid" && (
            <p role="alert" className="mb-5 rounded-[10px] border border-line bg-page px-3.5 py-3 text-[13px] leading-relaxed text-down">
              {dict.auth.linkInvalid}
            </p>
          )}
          <LoginForm dict={dict} locale={locale} provider={provider} next={safeRedirect(next, locale)} />
          {notice && (
            <p role="status" className="mt-4 text-[12px] leading-relaxed text-muted">
              {notice}
            </p>
          )}
        </Card>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-4 rounded-[14px] border border-dashed border-gold-line bg-gold-soft px-5 py-4">
          <div className="min-w-0">
            <Eyebrow>{dict.pricing.title}</Eyebrow>
            <p className="mt-1.5 max-w-[46ch] text-[13px] leading-relaxed text-ink-2">{dict.pricing.subtitle}</p>
          </div>
          <Link href={`/${locale}/${PATHS.pricing[locale]}`} className="shrink-0 text-[13px] font-semibold text-accent hover:underline">
            {dict.home.saveCta2} <span aria-hidden="true">→</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
