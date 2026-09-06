import Link from "next/link";
import { PageHeader } from "@/components/editorial";
import { PageShell, Panel } from "@/components/layout";
import { getDict, PATHS } from "@/lib/i18n";
import type { Locale } from "@/lib/types";

/**
 * The landing page of an emailed link.
 *
 * It reads nothing and consumes nothing — it renders a form. Redemption
 * happens only in the POST handler, so a mail scanner that follows the link
 * cannot burn the token. This view must never import the database.
 */
export function VerifyView({ locale, token }: { locale: Locale; token?: string }) {
  const dict = getDict(locale);

  return (
    <PageShell
      rail={
        <Panel title={dict.auth.title}>
          <p className="text-[13px] leading-relaxed text-ink-2">{dict.auth.magicNotice}</p>
        </Panel>
      }
    >
      <PageHeader title={dict.auth.verifyTitle} subtitle={dict.auth.verifyBody} />
      <div className="max-w-[420px]">
        {token ? (
          <form method="post" action="/api/auth/magic/verify" className="card p-5">
            <input type="hidden" name="token" value={token} />
            <input type="hidden" name="locale" value={locale} />
            <button
              type="submit"
              className="w-full rounded border border-line bg-surface-2 px-3 py-2 text-[13px] font-medium text-ink"
            >
              {dict.auth.verifyContinue}
            </button>
          </form>
        ) : (
          <div className="card p-5">
            <p role="alert" className="text-[13px] leading-relaxed text-ink-2">
              {dict.auth.linkInvalid}
            </p>
            <Link
              href={`/${locale}/${PATHS.login[locale]}`}
              className="mt-4 inline-block rounded border border-line bg-surface-2 px-3 py-2 text-[13px] font-medium text-ink hover:bg-surface"
            >
              {dict.auth.signIn}
            </Link>
          </div>
        )}
      </div>
    </PageShell>
  );
}
