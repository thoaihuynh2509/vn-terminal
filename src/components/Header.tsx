"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PATHS, type Dict } from "@/lib/i18n";
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

  const isActive = (href: string) =>
    href === `/${locale}` ? pathname === href : pathname.startsWith(href);

  // Seven flat destinations. The chart is the product, so it sits second,
  // not inside a "Markets" dropdown.
  const items: NavLink[] = [
    { href: `/${locale}`, label: dict.nav.home },
    { href: p("terminal"), label: dict.nav.terminal },
    { href: p("stocks"), label: dict.nav.stocks },
    { href: p("gold"), label: dict.nav.gold },
    { href: p("crypto"), label: dict.nav.crypto },
    { href: p("brief"), label: dict.nav.brief },
    { href: p("pricing"), label: dict.nav.pricing },
  ];

  const linkCls = (active: boolean) =>
    `whitespace-nowrap rounded px-2.5 py-1.5 text-[13px] font-medium ${
      active ? "bg-surface-2 text-ink" : "text-ink-2 hover:bg-surface-2 hover:text-ink"
    }`;

  return (
    <header className="border-b border-line bg-page">
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 md:h-14 md:flex-nowrap md:py-0">
        <Link href={`/${locale}`} className="order-1 flex shrink-0 items-baseline gap-2">
          <span className="text-[15px] font-bold tracking-tight">{dict.brand}</span>
          <span className="hidden text-[11px] text-muted xl:inline">{dict.tagline}</span>
        </Link>

        <div className="order-2 ml-auto flex shrink-0 items-center gap-2 md:order-3">
          <SymbolSearchButton label={dict.chart.changeSymbol} />
          <Link
            href={swapLocale(pathname, other)}
            aria-label={dict.lang.label}
            className="rounded border border-line px-2 py-1 text-[11px] font-semibold uppercase text-ink-2 hover:bg-surface-2 hover:text-ink"
          >
            {other}
          </Link>
          <ThemeToggle label={dict.theme.toggle} />
          <AccountMenu dict={dict} locale={locale} email={email} tier={tier} />
        </div>

        <nav aria-label={dict.nav.home} className="order-3 w-full md:order-2 md:ml-2 md:w-auto md:min-w-0 md:flex-1">
          <div className="relative -mx-1 flex items-center gap-1 overflow-x-auto px-1 md:mx-0 md:px-0">
            {items.map((it) => (
              <Link key={it.href} href={it.href} aria-current={isActive(it.href) ? "page" : undefined} className={linkCls(isActive(it.href))}>
                {it.label}
              </Link>
            ))}
          </div>
        </nav>
      </div>
      <SymbolSearch locale={locale} dict={dict} symbols={symbols} />
    </header>
  );
}
