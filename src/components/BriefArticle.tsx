import { Card } from "@/components/ui";
import { Heatmap } from "@/components/Heatmap";
import { SectorBars } from "@/components/SectorBars";
import { Sparkline } from "@/components/Sparkline";
import { ReadAloud } from "@/components/ReadAloud";
import { dirOf } from "@/lib/format";
import type { Brief, BriefSection } from "@/lib/brief";
import type { BriefVisuals } from "@/lib/briefs/snapshot";
import type { Dict } from "@/lib/i18n";
import type { Locale } from "@/lib/types";

/**
 * The brief, rendered.
 *
 * Extracted from `BriefView` so today's edition and an archived one are the
 * same markup — an archive that looked like a lesser page would tell a reader
 * (and a crawler) that it is one. The only difference is where the figures come
 * from: live feeds, or the snapshot stored that afternoon.
 */
export function BriefArticle({
  locale,
  dict,
  brief,
  visuals,
  dateLabel,
}: {
  locale: Locale;
  dict: Dict;
  brief: Brief;
  visuals: BriefVisuals;
  /** Already localised — the caller knows whether it is a day or a timestamp. */
  dateLabel: string;
}) {
  /** The figure a paragraph describes, where we hold the series for it. */
  function visual(id: BriefSection) {
    if (id === "indices" && visuals.vnindexSpark && visuals.vnindexSpark.length > 2) {
      return (
        <div className="mt-3">
          <Sparkline
            points={visuals.vnindexSpark}
            dir={dirOf(visuals.vnindexChangePct ?? 0, 2)}
            width={260}
            height={44}
          />
        </div>
      );
    }
    if (id === "breadth" && visuals.board.length) {
      return (
        <div className="mt-3">
          <Heatmap quotes={visuals.board} locale={locale} height={140} max={12} />
        </div>
      );
    }
    if (id === "rotation" && visuals.board.length) {
      return (
        <div className="mt-3">
          <SectorBars board={visuals.board} locale={locale} dict={dict} />
        </div>
      );
    }
    return null;
  }

  return (
    <article>
      <p className="text-[11px] font-bold uppercase tracking-wider text-muted">
        {dict.brief.title} · {dateLabel}
      </p>
      {/* Sans, not a serif: this is a data read-out, and the 38px display
          headline read as a different site from every other page. */}
      <h1 className="mt-2 max-w-[34ch] text-[28px] font-semibold leading-tight tracking-tight">
        {brief.headline}
      </h1>
      <p className="mt-4 max-w-[68ch] text-[14px] leading-relaxed text-ink-2">{brief.standfirst}</p>

      {/* Reads our own composed brief — no third-party text is ever spoken. */}
      <div className="mt-4">
        <ReadAloud
          text={[brief.headline, brief.standfirst, ...brief.paragraphs.flatMap((p) => p.sentences)].join(". ")}
          dict={dict}
          locale={locale}
        />
      </div>

      <div className="mt-8 grid gap-5 sm:grid-cols-2">
        {brief.paragraphs.map((p) => (
          <Card key={p.id} className="p-4">
            <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted">{p.heading}</h2>
            {/* The figure the paragraph is describing, drawn from the same data.
                A card that only has sentences about a shape should show the shape. */}
            {visual(p.id)}
            <div className="mt-2 space-y-2">
              {p.sentences.map((s, i) => (
                <p key={i} className="max-w-[68ch] text-[14px] leading-relaxed">{s}</p>
              ))}
            </div>
          </Card>
        ))}
      </div>

      <p className="mt-8 max-w-[68ch] text-[12px] leading-relaxed text-muted">{dict.brief.method}</p>
    </article>
  );
}
