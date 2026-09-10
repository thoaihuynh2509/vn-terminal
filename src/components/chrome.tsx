import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Section header: the heading, anything the section wants to hang off it, and
 * a "view all" on the right. The rhythm that makes a long, dense page
 * scannable without turning every block into a card.
 */
export function SectionHead({
  title,
  href,
  viewAll,
  subtitle,
  children,
}: {
  title: string;
  href?: string;
  viewAll?: string;
  subtitle?: string;
  children?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-[18px] font-semibold tracking-tight">{title}</h2>
          {children}
        </div>
        {subtitle && <p className="mt-1.5 max-w-[68ch] text-[14px] leading-relaxed text-ink-2">{subtitle}</p>}
      </div>
      {href && viewAll && (
        <Link href={href} className="shrink-0 text-[14px] font-medium text-accent hover:underline">
          {viewAll} <span aria-hidden="true">→</span>
        </Link>
      )}
    </div>
  );
}

/**
 * Deterministic thumbnail.
 *
 * The reference pairs every card with a photograph. There are no photographs
 * here and inventing stock imagery for financial explainers would be decorative
 * at best and misleading at worst, so each card gets a stable abstract block
 * derived from its slug — consistent per article, never a fake photo.
 */
export function Thumb({ seed, label, ratio = "16 / 9" }: { seed: string; label?: string; ratio?: string }) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360;
  const a = `oklch(0.62 0.11 ${h})`;
  const b = `oklch(0.48 0.13 ${(h + 42) % 360})`;
  return (
    <div
      aria-hidden="true"
      className="relative w-full overflow-hidden rounded-xl"
      style={{ aspectRatio: ratio, background: `linear-gradient(135deg, ${a}, ${b})` }}
    >
      {label && (
        <span className="absolute bottom-2 left-2 rounded bg-black/35 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide text-white backdrop-blur-sm">
          {label}
        </span>
      )}
    </div>
  );
}
