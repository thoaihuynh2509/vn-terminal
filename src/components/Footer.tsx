import { PATHS, type Dict } from "@/lib/i18n";

const SOURCES = [
  { label: "DNSE", href: "https://services.entrade.com.vn" },
  { label: "VNDirect", href: "https://dchart-api.vndirect.com.vn" },
  { label: "CafeF", href: "https://cafef.vn" },
  { label: "vang.today", href: "https://www.vang.today" },
];

/** Column heading — mono, uppercase, the same label rhythm as the eyebrows. */
function ColumnHead({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-muted">{children}</h2>
  );
}

function LinkList({ items }: { items: { label: string; href: string; external?: boolean }[] }) {
  return (
    <ul className="mt-3.5 flex flex-col gap-2.5">
      {items.map((it) => (
        <li key={it.label}>
          <a
            href={it.href}
            {...(it.external ? { target: "_blank", rel: "noreferrer noopener" } : {})}
            className="text-[14px] text-ink-2 underline-offset-2 hover:text-accent hover:underline"
          >
            {it.label}
          </a>
        </li>
      ))}
    </ul>
  );
}

export function Footer({ dict, locale = "vi" }: { dict: Dict; locale?: "vi" | "en" }) {
  const p = (k: keyof typeof PATHS) => `/${locale}/${PATHS[k][locale]}`;

  return (
    <footer className="mt-16 border-t border-line bg-surface">
      <div className="mx-auto max-w-[1400px] px-4 py-11 sm:px-6 lg:px-8">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[340px_repeat(3,minmax(0,1fr))]">
          <div>
            <div className="flex items-center gap-2.5">
              <span
                aria-hidden="true"
                className="grid h-7 w-7 place-items-center rounded-lg bg-chrome font-mono text-[14px] font-semibold text-gold"
              >
                {dict.brand.trim().charAt(0)}
              </span>
              <span className="text-[15px] font-semibold tracking-tight">{dict.brand}</span>
            </div>
            <h2 className="sr-only">{dict.disclaimer.title}</h2>
            <p className="mt-3.5 max-w-[46ch] text-[13px] leading-relaxed text-muted">{dict.disclaimer.body}</p>
          </div>

          <div>
            <ColumnHead>{dict.nav.markets}</ColumnHead>
            <LinkList
              items={[
                { label: dict.nav.stocks, href: p("stocks") },
                { label: dict.nav.terminal, href: p("terminal") },
                { label: dict.nav.heatmap, href: p("heatmap") },
                { label: dict.nav.gold, href: p("gold") },
                { label: dict.nav.brief, href: p("brief") },
              ]}
            />
          </div>

          <div>
            <ColumnHead>{dict.auth.account}</ColumnHead>
            <LinkList
              items={[
                { label: dict.nav.pricing, href: p("pricing") },
                { label: dict.auth.signIn, href: p("login") },
                { label: dict.home.yourWatch, href: p("watchlist") },
                { label: dict.nav.ask, href: p("ask") },
              ]}
            />
          </div>

          <div>
            <ColumnHead>{dict.footer.sources}</ColumnHead>
            <LinkList items={SOURCES.map((s) => ({ ...s, external: true }))} />
          </div>
        </div>

        <p className="mt-9 border-t border-line pt-5 text-[12px] text-muted">
          © {new Date().getFullYear()} {dict.brand}. {dict.footer.rights}
        </p>
      </div>
    </footer>
  );
}
