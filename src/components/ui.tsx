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
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
          {subtitle && <p className="mt-0.5 text-[12px] text-muted">{subtitle}</p>}
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
 * Stat tile — the correct form when the story is one number. Hero figures keep
 * proportional figures (no tabular-nums) per the type spec; only aligned columns
 * get tabular figures.
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
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1.5 text-[24px] font-semibold leading-none tracking-tight">{value}</div>
      {sub && <div className="mt-1.5 text-[12px]">{sub}</div>}
    </>
  );
  const cls = "block card p-3.5";
  return href ? (
    <a href={href} className={`${cls} card-hover`}>{body}</a>
  ) : (
    <div className={cls}>{body}</div>
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
      className="ml-1 inline-block rounded px-1 py-px text-[10px] font-bold leading-tight text-white"
      style={{ background: kind === "ceiling" ? "var(--up)" : "var(--down)" }}
    >
      {label}
    </span>
  );
}
