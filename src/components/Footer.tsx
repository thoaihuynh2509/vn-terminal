import { PATHS, type Dict } from "@/lib/i18n";
import { cryptoEnabled } from "@/lib/flags";

const SOURCES = [
  { label: "DNSE", href: "https://services.entrade.com.vn" },
  { label: "VNDirect", href: "https://dchart-api.vndirect.com.vn" },
  { label: "CafeF", href: "https://cafef.vn" },
  { label: "vang.today", href: "https://www.vang.today" },
];

/** Only cited when the section that reads it is actually on. */
const CRYPTO_SOURCE = { label: "CoinGecko", href: "https://www.coingecko.com" };

export function Footer({ dict, locale = "vi" }: { dict: Dict; locale?: "vi" | "en" }) {
  // The footer linked crypto unconditionally while `/crypto` 404s with the flag
  // off — a dead link on every page of the site.
  const crypto = cryptoEnabled();
  const sources = crypto ? [...SOURCES, CRYPTO_SOURCE] : SOURCES;
  return (
    <footer className="mt-12 border-t border-line bg-surface">
      <div className="mx-auto max-w-[1400px] px-4 py-8">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-muted">
          {dict.disclaimer.title}
        </h2>
        <p className="mt-2 max-w-3xl text-[13px] leading-relaxed text-ink-2">{dict.disclaimer.body}</p>

        <h2 className="mt-6 text-[11px] font-semibold uppercase tracking-wide text-muted">
          {dict.nav.markets}
        </h2>
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
          {([
            ["stocks", dict.nav.stocks], ["gold", dict.nav.gold],
            ...(crypto ? [["crypto", dict.nav.crypto] as const] : []),
            ["heatmap", dict.nav.heatmap], ["terminal", dict.nav.terminal], ["brief", dict.nav.brief], ["pricing", dict.nav.pricing],
          ] as const).map(([key, label]) => (
            <li key={key}>
              <a href={`/${locale}/${PATHS[key][locale]}`} className="text-[13px] text-ink-2 underline-offset-2 hover:text-accent hover:underline">
                {label}
              </a>
            </li>
          ))}
        </ul>

        <h2 className="mt-6 text-[11px] font-semibold uppercase tracking-wide text-muted">
          {dict.footer.sources}
        </h2>
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
          {sources.map((s) => (
            <li key={s.label}>
              <a
                href={s.href}
                target="_blank"
                rel="noreferrer noopener"
                className="text-[13px] text-accent underline-offset-2 hover:underline"
              >
                {s.label}
              </a>
            </li>
          ))}
        </ul>

        <p className="mt-6 text-[12px] text-muted">
          © {new Date().getFullYear()} {dict.brand}. {dict.footer.rights}
        </p>
      </div>
    </footer>
  );
}
