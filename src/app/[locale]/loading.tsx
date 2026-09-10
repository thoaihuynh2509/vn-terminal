"use client";

import { useParams } from "next/navigation";
import { Card, SkeletonBar } from "@/components/ui";
import { DEFAULT_LOCALE, getDict, isLocale } from "@/lib/i18n";

/**
 * The instant loading state for every route under /:locale.
 *
 * Its job is not to look like any one page — the routes below it are a board,
 * a chart, an article and a pricing table — but to hold the page's SHAPE while
 * the server renders: a heading block, then the wide content column the board,
 * the heatmap and the brief all share. Anything more specific would swap into
 * the wrong thing on four routes out of five.
 *
 * A Client Component only because `loading.tsx` receives no params and the
 * label has to be in the reader's language; `getDict` is already in the client
 * bundle via AskBox, so this costs no extra bytes.
 */
export default function Loading() {
  const params = useParams<{ locale: string }>();
  const locale = isLocale(params.locale) ? params.locale : DEFAULT_LOCALE;
  const dict = getDict(locale);

  return (
    <div role="status" aria-label={dict.common.loading}>
      {/* Heading block: eyebrow, title, standfirst. */}
      <div className="mb-8">
        <SkeletonBar ch={14} className="text-[11px]" />
        <div className="mt-4">
          <SkeletonBar ch={22} className="text-[32px]" />
        </div>
        <div className="mt-4">
          <SkeletonBar ch={46} className="text-[15px]" />
        </div>
      </div>

      {/* The figure row that opens the board, the gold page and the heatmap. */}
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Card key={i} className="p-5">
            <SkeletonBar ch={10} className="text-[11px]" />
            <div className="mt-3">
              <SkeletonBar ch={12} className="text-[26px]" />
            </div>
          </Card>
        ))}
      </div>

      {/* The tall content column: a table on most routes, prose on the brief. */}
      <Card className="p-5">
        {ROW_WIDTHS.map((w, i) => (
          <div
            key={i}
            className="flex items-baseline justify-between gap-4 border-b border-line py-3 last:border-0"
          >
            <SkeletonBar ch={w} className="text-[14px]" />
            <SkeletonBar ch={9} className="text-[14px]" />
          </div>
        ))}
      </Card>
    </div>
  );
}

/** Ragged widths, so the block reads as pending content rather than a grid. */
const ROW_WIDTHS = [8, 12, 9, 14, 10, 11, 8, 13];
