import { Card, SkeletonBar } from "@/components/ui";

/**
 * The instant loading state a route shows while the server renders it.
 *
 * Its job is not to look like any one page — the routes that use it are a
 * board, an index, an article list and a pricing table — but to hold the
 * page's SHAPE: a heading block, then the wide content column they share.
 * Anything more specific would swap into the wrong thing on most of them.
 *
 * Nothing here is announced. There is nothing to say that the router does not
 * already say — the App Router names the new page on navigation — so the bars
 * are hidden from assistive tech as the scaffolding they are.
 *
 * WHERE THIS MAY BE USED, and why it is not simply at `[locale]/loading.tsx`:
 * a route that renders this has begun streaming, and a response that has begun
 * streaming has already sent its status. `notFound()` and `permanentRedirect()`
 * can then only change the markup, never the code. So every segment that can
 * answer something other than 200 — the symbol charts, the brief archive, the
 * old symbol URLs that 308 to the terminal — is deliberately left outside the
 * boundary, and each segment that cannot opts in for itself.
 */
export function RouteSkeleton() {
  return (
    <div aria-hidden="true">
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
