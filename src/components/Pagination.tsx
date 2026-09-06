import Link from "next/link";
import type { Dict } from "@/lib/i18n";

/**
 * Numbered pagination for article listings.
 *
 * Numbered rather than a "load more" button, because each page of an article
 * index should be its own crawlable URL — a load-more feed hides every article
 * past the first page from search engines. The wire uses load-more instead
 * precisely because it is a members-only feed with nothing to index.
 *
 * Server-rendered links only: no client JS, and the back button works.
 */
export function Pagination({
  page,
  totalPages,
  hrefFor,
  dict,
}: {
  page: number;
  totalPages: number;
  hrefFor: (page: number) => string;
  dict: Dict;
}) {
  if (totalPages <= 1) return null;

  // Compact window around the current page so 40 pages do not render 40 links.
  const window: number[] = [];
  const push = (n: number) => {
    if (n >= 1 && n <= totalPages && !window.includes(n)) window.push(n);
  };
  push(1);
  for (let n = page - 1; n <= page + 1; n++) push(n);
  push(totalPages);
  window.sort((a, b) => a - b);

  const cell =
    "inline-flex min-w-[34px] items-center justify-center rounded border px-2.5 py-1.5 text-[13px] font-medium";

  return (
    <nav aria-label={dict.news.page} className="mt-8 flex flex-wrap items-center justify-center gap-1.5">
      <Link
        href={hrefFor(page - 1)}
        aria-disabled={page <= 1}
        tabIndex={page <= 1 ? -1 : undefined}
        className={`${cell} ${page <= 1 ? "pointer-events-none border-line text-muted opacity-50" : "border-line text-ink-2 hover:bg-surface-2 hover:text-ink"}`}
      >
        {dict.news.prev}
      </Link>

      {window.map((n, i) => (
        <span key={n} className="flex items-center gap-1.5">
          {/* A gap in the sequence gets an ellipsis rather than a silent jump. */}
          {i > 0 && n - window[i - 1] > 1 && <span className="px-1 text-[13px] text-muted">…</span>}
          <Link
            href={hrefFor(n)}
            aria-current={n === page ? "page" : undefined}
            aria-label={`${dict.news.page} ${n}`}
            className={`${cell} tnum ${
              n === page
                ? "border-accent bg-surface-2 text-ink"
                : "border-line text-ink-2 hover:bg-surface-2 hover:text-ink"
            }`}
          >
            {n}
          </Link>
        </span>
      ))}

      <Link
        href={hrefFor(page + 1)}
        aria-disabled={page >= totalPages}
        tabIndex={page >= totalPages ? -1 : undefined}
        className={`${cell} ${page >= totalPages ? "pointer-events-none border-line text-muted opacity-50" : "border-line text-ink-2 hover:bg-surface-2 hover:text-ink"}`}
      >
        {dict.news.next}
      </Link>
    </nav>
  );
}
