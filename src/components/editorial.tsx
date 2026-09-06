import type { ReactNode } from "react";
/** One page-title treatment for every page, so headers stop drifting apart. */
export function PageHeader({
  title,
  subtitle,
  meta,
  action,
}: {
  title: string;
  subtitle?: string;
  meta?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-[20px] font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 max-w-[68ch] text-[13px] text-muted">{subtitle}</p>}
        {meta && <div className="mt-2 text-[12px] text-muted">{meta}</div>}
      </div>
      {action}
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
      className="prose-vn max-w-[68ch] text-[15px] leading-[1.75] text-ink"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
