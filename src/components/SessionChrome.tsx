import { connection } from "next/server";
import { Suspense } from "react";
import { Header } from "@/components/Header";
import { Identify } from "@/components/Identify";
import { WatchlistSync } from "@/components/WatchlistSync";
import { personId } from "@/lib/analytics/server";
import { getSession } from "@/lib/auth/session";
import { cryptoEnabled } from "@/lib/flags";
import { ALL_SYMBOLS } from "@/lib/universe";
import type { Dict } from "@/lib/i18n";
import type { Locale } from "@/lib/types";

/**
 * Everything on the page that depends on WHO is asking.
 *
 * Split out of the locale layout because reading the session there called
 * `cookies()` in the layout body, which opts the whole subtree into dynamic
 * rendering. Isolated and suspended, the rest of the page is no longer held
 * behind the session read.
 *
 * This does NOT make the routes static — that needs Cache Components, which
 * this app does not enable; see docs/backend-issues.md for why. It is the
 * structural prerequisite if that is ever revisited, and a real improvement on
 * its own: the page streams instead of blocking on a cookie read.
 *
 * The fallback is the SIGNED-OUT chrome rather than a skeleton, because that is
 * what the shell honestly is before anyone is identified — and it means a reader
 * who is not signed in sees no swap at all. A signed-in reader sees the header
 * resolve from anonymous to their account, which is the trade this makes.
 */
export async function SessionChrome({ locale, dict }: { locale: Locale; dict: Dict }) {
  // Marks this as request-time work. Suspense alone is not enough: it provides
  // a fallback but does not by itself opt a component out of prerendering, and
  // the live feeds underneath read the clock. Without this the whole route is
  // held back to the slowest upstream.
  await connection();
  const session = await getSession();
  return (
    <>
      <Header
        locale={locale} dict={dict}
        email={session?.email ?? null}
        tier={session?.tier ?? "anon"}
        symbols={ALL_SYMBOLS}
        cryptoEnabled={cryptoEnabled()}
      />
      <WatchlistSync email={session?.email ?? null} />
      <Identify
        tier={session?.tier ?? "anon"}
        locale={locale}
        signedIn={!!session?.email}
        expiresAt={session?.exp ?? null}
        personId={session?.email ? personId(session.email) : null}
      />
    </>
  );
}

/**
 * The shell's header: the same component, in the state it holds before the
 * session resolves. Identical markup means no layout shift when it swaps.
 */
export function SessionChromeFallback({ locale, dict }: { locale: Locale; dict: Dict }) {
  return (
    <Suspense fallback={<div className="h-14 border-b border-line" aria-hidden="true" />}>
    <Header
      locale={locale} dict={dict}
      email={null} tier="anon"
      symbols={ALL_SYMBOLS}
      cryptoEnabled={cryptoEnabled()}
    />
    </Suspense>
  );
}
