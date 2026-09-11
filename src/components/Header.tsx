"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { PATHS, type Dict } from "@/lib/i18n";
import { DEFAULT_SYMBOL } from "@/lib/chart/default-symbol";
import type { Locale, Tier } from "@/lib/types";
import { ThemeToggle } from "./ThemeToggle";
import { AccountMenu } from "./AccountMenu";
import { SymbolSearch, SymbolSearchButton } from "./SymbolSearch";

/**
 * Route segments are localised (/vi/chung-khoan ↔ /en/stocks), so switching
 * language has to translate the segment as well as the prefix — otherwise the
 * reader lands on a 404 whenever they switch away from the home page.
 */
function swapLocale(pathname: string, to: Locale): string {
  const parts = pathname.split("/").filter(Boolean);
  const from: Locale = parts[0] === "en" ? "en" : "vi";
  if (from === to) return pathname;
  const translated = parts.slice(1).map((seg) => {
    const entry = Object.values(PATHS).find((p) => p[from] === seg);
    return entry ? entry[to] : seg;
  });
  return `/${[to, ...translated].join("/")}`;
}

interface NavLink { href: string; label: string }

export function Header({
  locale,
  dict,
  email = null,
  tier = "anon",
  symbols,
}: {
  locale: Locale;
  dict: Dict;
  email?: string | null;
  tier?: Tier;
  /** Everything the chart can show — the search dialog's universe. */
  symbols: string[];
}) {
  const pathname = usePathname() || `/${locale}`;
  const other: Locale = locale === "vi" ? "en" : "vi";
  const p = (k: keyof typeof PATHS) => `/${locale}/${PATHS[k][locale]}`;
  // Straight to a chart. `/bieu-do` on its own only redirects here, and that
  // redirect cost a whole server round trip on every click of the nav item.
  const chartHref = `${p("terminal")}/${DEFAULT_SYMBOL}`;

  /**
   * The assistant has no page of its own — /hoi-ai redirects into the chart
   * with its rail open — so "which nav item am I on" cannot be read from the
   * path alone. Without the rail, clicking the assistant highlighted the chart
   * instead, and the assistant item could never be current at all.
   */
  const onAsk = (useSearchParams()?.get("rail") ?? null) === "ask";
  const onTerminal = pathname.startsWith(p("terminal"));

  const isActive = (href: string) => {
    if (href === p("ask")) return onTerminal && onAsk;
    if (href === chartHref) return onTerminal && !onAsk;
    return href === `/${locale}` ? pathname === href : pathname.startsWith(href);
  };

  // Five flat destinations plus the assistant. The chart is the product, so it
  // sits second, not inside a "Markets" dropdown.
  const items: NavLink[] = [
    { href: `/${locale}`, label: dict.nav.home },
    { href: chartHref, label: dict.nav.terminal },
    { href: p("stocks"), label: dict.nav.stocks },
    { href: p("gold"), label: dict.nav.gold },
    { href: p("brief"), label: dict.nav.brief },
  ];

  const linkCls = (active: boolean) =>
    `whitespace-nowrap rounded-lg px-3 py-2 text-[14px] font-medium transition-colors ${
      active ? "bg-page text-ink" : "text-ink-2 hover:bg-page hover:text-ink"
    }`;

  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 sm:px-6 lg:h-[68px] lg:flex-nowrap lg:gap-x-6 lg:px-8 lg:py-0">
        <Link href={`/${locale}`} className="order-1 flex shrink-0 items-center gap-2.5">
          {/* The mark: the brand's initial in gold on chrome. It is decorative
              — the wordmark beside it is the accessible name of the link. */}
          <span
            aria-hidden="true"
            className="grid h-[30px] w-[30px] place-items-center rounded-lg bg-chrome font-mono text-[15px] font-semibold text-gold"
          >
            {dict.brand.trim().charAt(0)}
          </span>
          <span className="text-[17px] font-semibold tracking-tight">{dict.brand}</span>
        </Link>

        <div className="order-2 ml-auto flex shrink-0 items-center gap-2 lg:order-3">
          <SymbolSearchButton label={dict.chart.changeSymbol} />
          <Link
            href={swapLocale(pathname, other)}
            aria-label={dict.lang.label}
            className="rounded-lg border border-line px-2.5 py-1.5 text-[11px] font-semibold uppercase text-ink-2 hover:border-ink hover:text-ink"
          >
            {other}
          </Link>
          <ThemeToggle label={dict.theme.toggle} />
          <AccountMenu dict={dict} locale={locale} email={email} tier={tier} />
          {/* The one paid CTA in the chrome. A Pro reader has nothing left to
              buy, so they get the space back instead of a dead button. */}
          {tier !== "pro" && (
            <Link
              href={p("pricing")}
              className="hidden whitespace-nowrap rounded-lg bg-btn px-4 py-2.5 text-[14px] font-semibold text-btn-ink hover:bg-btn-hover sm:inline-block"
            >
              {tier === "anon" ? dict.pricing.title : dict.pricing.upgrade}
            </Link>
          )}
        </div>

        <nav aria-label={dict.nav.home} className="order-3 w-full lg:order-2 lg:w-auto lg:min-w-0 lg:flex-1">
          <div className="relative -mx-1 flex items-center gap-1 overflow-x-auto px-1 pb-1 lg:mx-0 lg:px-0 lg:pb-0">
            {items.map((it) => (
              <Link key={it.href} href={it.href} aria-current={isActive(it.href) ? "page" : undefined} className={`relative ${linkCls(isActive(it.href))}`}>
                {it.label}
                <PendingHint />
              </Link>
            ))}
            <Link
              href={p("ask")}
              aria-current={isActive(p("ask")) ? "page" : undefined}
              className={`relative ${linkCls(isActive(p("ask")))} inline-flex items-center gap-1.5`}
            >
              <PendingHint />
              {dict.nav.ask}
              <span className="rounded bg-gold-soft px-1.5 py-px font-mono text-[10px] font-semibold uppercase text-accent">
                {dict.pricing.plus}
              </span>
            </Link>
          </div>
        </nav>
      </div>
      <SymbolSearch locale={locale} dict={dict} symbols={symbols} />
    </header>
  );
}

/**
 * A bar under a nav item while its page loads.
 *
 * The chart route has no loading skeleton — it has to be able to answer a real
 * 404 — so without this a click on the chart changed nothing on screen for the
 * second or more the server takes. Always rendered and only faded in, so it
 * never shifts the row.
 */
function PendingHint() {
  const { pending } = useLinkStatus();
  return (
    <span
      aria-hidden="true"
      className={`pointer-events-none absolute inset-x-3 bottom-0.5 h-0.5 rounded-full bg-accent transition-opacity ${
        pending ? "animate-pulse opacity-100" : "opacity-0"
      }`}
    />
  );
}
