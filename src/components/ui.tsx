import Link from "next/link";
import type { ReactNode } from "react";

export function Section({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="mb-8">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-[18px] font-semibold tracking-tight">{title}</h2>
          {subtitle && <p className="mt-1 text-[13px] text-ink-2">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`card ${className}`}>{children}</div>;
}

/**
 * Eyebrow — the mono, uppercase, gold kicker that opens a section.
 *
 * `tone="chrome"` is the same label on a dark panel, where --accent is too
 * dark to read and --gold takes over as the text colour.
 */
export function Eyebrow({
  children,
  tone = "default",
  className = "",
}: {
  children: ReactNode;
  tone?: "default" | "chrome" | "muted";
  className?: string;
}) {
  const colour = tone === "chrome" ? "text-gold" : tone === "muted" ? "text-muted" : "text-accent";
  return (
    <span className={`font-mono text-[11px] font-medium uppercase tracking-[0.14em] ${colour} ${className}`}>
      {children}
    </span>
  );
}

/**
 * The three call-to-action treatments in the system, in order of weight:
 * `gold` (the one paid action on a page), `primary` (chrome), `ghost`.
 *
 * Gold fills carry --gold-ink and never white; chrome fills carry
 * --chrome-ink. Both pairs are fixed here so a caller cannot pick an
 * illegal combination by hand.
 */
const CTA: Record<"gold" | "primary" | "ghost", string> = {
  gold: "bg-gold text-gold-ink hover:bg-gold-hover",
  primary: "bg-btn text-btn-ink hover:bg-btn-hover",
  ghost: "border border-axis bg-surface text-ink hover:border-ink",
};

export function CtaLink({
  href,
  variant = "primary",
  size = "md",
  className = "",
  children,
}: {
  href: string;
  variant?: "gold" | "primary" | "ghost";
  size?: "sm" | "md" | "lg";
  className?: string;
  children: ReactNode;
}) {
  const pad = size === "lg" ? "px-5 py-3.5 text-[15px]" : size === "sm" ? "px-3.5 py-2 text-[13px]" : "px-4 py-2.5 text-[14px]";
  return (
    <Link href={href} className={`inline-flex items-center justify-center gap-2 rounded-[10px] font-semibold ${pad} ${CTA[variant]} ${className}`}>
      {children}
    </Link>
  );
}

/**
 * Stat tile — the correct form when the story is one number.
 *
 * Figures are mono across the product; the label above is the mono uppercase
 * micro-caps the board uses for every column head.
 */
export function StatTile({
  label,
  value,
  sub,
  href,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  href?: string;
}) {
  const body = (
    <>
      <div className="font-mono text-[11px] uppercase tracking-[0.1em] text-muted">{label}</div>
      <div className="mt-2.5 font-mono text-[28px] font-medium leading-none tracking-tight">{value}</div>
      {sub && <div className="mt-2 text-[13px]">{sub}</div>}
    </>
  );
  const cls = "block card p-5";
  return href ? (
    <a href={href} className={`${cls} card-hover`}>{body}</a>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/**
 * The paywall band that closes a gated block — under a table whose last
 * columns are locked, under the chart, beside the gold board.
 *
 * Gold-on-gold: a soft gold ground inside a dashed gold rule, so the band
 * reads as "there is more here" rather than as an error.
 */
export function UpgradeBand({
  eyebrow,
  title,
  body,
  cta,
  href,
}: {
  eyebrow?: string;
  title: string;
  body?: string;
  cta: string;
  href: string;
}) {
  return (
    <div className="flex flex-col gap-4 rounded-[14px] border border-dashed border-gold-line bg-gold-soft px-5 py-4.5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3.5">
        <span aria-hidden="true" className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-gold text-[15px] text-gold-ink">
          ★
        </span>
        <div className="min-w-0">
          {eyebrow && <div className="mb-1"><Eyebrow>{eyebrow}</Eyebrow></div>}
          <p className="text-[14px] font-semibold">{title}</p>
          {body && <p className="mt-1 max-w-[62ch] text-[13px] leading-relaxed text-ink-2">{body}</p>}
        </div>
      </div>
      <CtaLink href={href} variant="primary" className="shrink-0">{cta}</CtaLink>
    </div>
  );
}

/**
 * The dark "what you get when you pay" panel: chrome ground, gold eyebrow,
 * gold CTA. Its own colour pair, because --ink-2 and --accent are both
 * unreadable on chrome.
 */
export function DarkPanel({
  eyebrow,
  title,
  body,
  cta,
  href,
  children,
  className = "",
}: {
  eyebrow?: string;
  title: string;
  body?: string;
  cta?: string;
  href?: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-[16px] bg-chrome p-6 text-chrome-ink ${className}`}>
      {eyebrow && <Eyebrow tone="chrome">{eyebrow}</Eyebrow>}
      <h2 className={`max-w-[26ch] text-[20px] font-semibold leading-snug tracking-tight ${eyebrow ? "mt-3.5" : ""}`}>
        {title}
      </h2>
      {body && <p className="mt-3 max-w-[56ch] text-[14px] leading-relaxed text-chrome-ink-2">{body}</p>}
      {children}
      {cta && href && <CtaLink href={href} variant="gold" className="mt-5">{cta}</CtaLink>}
    </section>
  );
}

/**
 * Ceiling / floor chip.
 *
 * VN boards traditionally paint trần purple and sàn cyan, but a five-hue board
 * cannot clear the palette's all-pairs separation gate (violet↔blue measured
 * ΔE 1.9 under protanopia in dark mode — and confusing ceiling with floor is the
 * worst error this UI could cause). So the limit states reuse the up/down hue and
 * are distinguished by a SOLID chip plus a text label: shape + text, not hue.
 */
export function LimitChip({ kind, label }: { kind: "ceiling" | "floor"; label: string }) {
  return (
    <span
      className="ml-1 inline-block rounded px-1 py-px font-mono text-[10px] font-bold leading-tight text-white"
      style={{ background: kind === "ceiling" ? "var(--up)" : "var(--down)" }}
    >
      {label}
    </span>
  );
}
