import { LoginForm } from "@/components/LoginForm";
import { PageHeader } from "@/components/editorial";
import { PageShell, Panel } from "@/components/layout";
import { activeAuthProvider } from "@/lib/auth/provider";
import { safeRedirect } from "@/lib/auth/magic";
import { getDict } from "@/lib/i18n";
import type { Locale } from "@/lib/types";

export function LoginView({ locale, next, error }: { locale: Locale; next?: string; error?: string }) {
  const dict = getDict(locale);
  const provider = activeAuthProvider();
  const notice = provider === "dev" ? dict.auth.devNotice : provider === "magic" ? dict.auth.magicNotice : null;

  return (
    <PageShell
      rail={
        <Panel title={dict.pricing.title}>
          <p className="text-[13px] leading-relaxed text-ink-2">{dict.pricing.subtitle}</p>
        </Panel>
      }
    >
      <PageHeader title={dict.auth.title} subtitle={dict.auth.subtitle} />
      {error === "link_invalid" && (
        <p role="alert" className="mb-4 max-w-[68ch] rounded border border-line bg-surface-2 px-3 py-2.5 text-[13px] leading-relaxed text-down">
          {dict.auth.linkInvalid}
        </p>
      )}
      {notice && (
        <p role="status" className="mb-4 max-w-[68ch] rounded border border-line bg-surface-2 px-3 py-2.5 text-[12px] leading-relaxed text-ink-2">
          {notice}
        </p>
      )}
      <div className="max-w-[420px]">
        <LoginForm dict={dict} locale={locale} provider={provider} next={safeRedirect(next, locale)} />
      </div>
    </PageShell>
  );
}
