import type { ReactNode } from "react";
import { Eyebrow } from "./ui";

/**
 * One page-title treatment for every page, so headers stop drifting apart.
 *
 * `size="hero"` is the marketing register — the landing, pricing and sign-in
 * pages, where the title is the first thing on the page rather than a label
 * over a board.
 */
export function PageHeader({
  title,
  subtitle,
  eyebrow,
  meta,
  action,
  size = "page",
  align = "start",
}: {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  meta?: ReactNode;
  action?: ReactNode;
  size?: "page" | "hero";
  align?: "start" | "center";
}) {
  const hero = size === "hero";
  const centred = align === "center";
  return (
    <div
      className={`mb-7 flex flex-wrap gap-x-8 gap-y-4 ${
        centred ? "flex-col items-center text-center" : "items-end justify-between"
      }`}
    >
      <div className={`min-w-0 ${centred ? "flex flex-col items-center" : ""}`}>
        {eyebrow && <div className="mb-3.5"><Eyebrow>{eyebrow}</Eyebrow></div>}
        <h1
          className={`font-semibold tracking-[-0.03em] ${
            hero ? "max-w-[20ch] text-[36px] leading-[1.1] sm:text-[44px]" : "text-[28px] leading-tight sm:text-[34px]"
          }`}
        >
          {title}
        </h1>
        {subtitle && (
          <p className={`mt-3 text-[15px] leading-relaxed text-ink-2 ${hero ? "max-w-[60ch] sm:text-[16px]" : "max-w-[66ch]"}`}>
            {subtitle}
          </p>
        )}
        {meta && <div className="mt-3 font-mono text-[12px] text-muted">{meta}</div>}
      </div>
      {action && <div className={centred ? "" : "shrink-0"}>{action}</div>}
    </div>
  );
}

/**
 * Article body. Markdown is rendered to HTML at build/request time from
 * in-repo files, so the HTML is trusted; styling is applied here rather than
 * with a typography plugin to keep the token system as the single source.
 */
export function Prose({ html }: { html: string }) {
  return (
    <div
      className="prose-vn max-w-[68ch] text-[16px] leading-[1.75] text-ink"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
