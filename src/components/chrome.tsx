import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Section header: accent bullet, uppercase label, optional "view all" on the
 * right — the rhythm that makes the reference's long home page scannable.
 */
export function SectionHead({
  title,
  href,
  viewAll,
  children,
}: {
  title: string;
  href?: string;
  viewAll?: string;
  children?: ReactNode;
}) {
  return (
    <div className="mb-3 flex items-center gap-2 border-b border-line pb-2">
      <span aria-hidden="true" className="h-1.5 w-1.5 rotate-45 bg-accent" />
      <h2 className="text-[12px] font-bold uppercase tracking-wider">{title}</h2>
      {children}
      {href && viewAll && (
        <Link href={href} className="ml-auto shrink-0 text-[11px] font-medium uppercase tracking-wide text-ink-2 hover:text-accent">
          {viewAll}
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
      className="relative w-full overflow-hidden rounded"
      style={{ aspectRatio: ratio, background: `linear-gradient(135deg, ${a}, ${b})` }}
    >
      {label && (
        <span className="absolute bottom-2 left-2 rounded bg-black/35 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white backdrop-blur-sm">
          {label}
        </span>
      )}
    </div>
  );
}
