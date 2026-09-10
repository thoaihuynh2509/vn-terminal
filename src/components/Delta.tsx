import { arrow, dirClass, dirOf, pct, signed } from "@/lib/format";
import type { Locale } from "@/lib/types";

/**
 * The single place direction is rendered.
 *
 * The up/down hues sit in the 6–8 CVD separation band in light mode, which the
 * palette method permits ONLY alongside secondary encoding. That encoding lives
 * here: an ▲/▼/— glyph plus an always-signed number. Never render a raw coloured
 * delta anywhere else — route it through this component so the glyph cannot be
 * dropped by accident.
 */
export function Delta({
  change,
  changePct,
  locale,
  digits = 2,
  className = "",
  showAbsolute = true,
}: {
  change: number;
  changePct?: number;
  locale: Locale;
  digits?: number;
  className?: string;
  showAbsolute?: boolean;
}) {
  const dir = dirOf(change, digits);
  const label = dir === "up" ? "tăng" : dir === "down" ? "giảm" : "không đổi";

  // Unchanged is the absence of a signal: a bare dash in neutral ink reads far
  // better than a signed zero ("— 0") and keeps the eye on the rows that moved.
  if (dir === "flat") {
    return (
      <span className={`text-ink-2 ${className}`}>
        <span aria-hidden="true">—</span>
        <span className="sr-only">{label}</span>
      </span>
    );
  }

  return (
    <span className={`tnum inline-flex items-center gap-1 font-mono ${dirClass(dir)} ${className}`}>
      <span aria-hidden="true">{arrow(dir)}</span>
      <span className="sr-only">{label}</span>
      {showAbsolute && <span>{signed(change, locale, digits)}</span>}
      {changePct !== undefined && (
        <span className={showAbsolute ? "opacity-80" : ""}>
          {showAbsolute ? `(${pct(changePct, locale)})` : pct(changePct, locale)}
        </span>
      )}
    </span>
  );
}
