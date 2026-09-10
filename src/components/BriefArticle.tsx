import { Heatmap } from "@/components/Heatmap";
import { SectorBars } from "@/components/SectorBars";
import { Sparkline } from "@/components/Sparkline";
import { ReadAloud } from "@/components/ReadAloud";
import { Eyebrow } from "@/components/ui";
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
 *
 * The register is editorial: one column at a 68ch measure, each section's
 * figure sitting inside the paragraph that describes it, rather than a grid of
 * equal cards that gives every section the same weight.
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
        <div className="mt-4">
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
        <div className="mt-4 max-w-[68ch]">
          <Heatmap quotes={visuals.board} locale={locale} height={150} max={12} />
        </div>
      );
    }
    if (id === "rotation" && visuals.board.length) {
      return (
        <div className="mt-4 max-w-[52ch]">
          <SectorBars board={visuals.board} locale={locale} dict={dict} />
        </div>
      );
    }
    return null;
  }

  return (
    <article className="min-w-0">
      <Eyebrow>{dict.brief.title} · {dateLabel}</Eyebrow>
      {/* Sans, not a serif: this is a data read-out, and a display serif would
          read as a different site from every other page. */}
      <h1 className="mt-3.5 max-w-[24ch] text-[34px] font-semibold leading-[1.12] tracking-[-0.035em] sm:text-[42px]">
        {brief.headline}
      </h1>
      <p className="mt-4.5 max-w-[66ch] text-[16px] leading-relaxed text-ink-2 sm:text-[17px]">{brief.standfirst}</p>

      {/* Reads our own composed brief — no third-party text is ever spoken. */}
      <div className="mt-6">
        <ReadAloud
          text={[brief.headline, brief.standfirst, ...brief.paragraphs.flatMap((p) => p.sentences)].join(". ")}
          dict={dict}
          locale={locale}
        />
      </div>

      <div className="mt-9 space-y-8">
        {brief.paragraphs.map((p) => (
          <section key={p.id}>
            <h2 className="text-[20px] font-semibold tracking-tight">{p.heading}</h2>
            <div className="mt-3 space-y-3">
              {p.sentences.map((s, i) => (
                <p key={i} className="max-w-[68ch] text-[16px] leading-[1.75]">{s}</p>
              ))}
            </div>
            {/* The figure the paragraph is describing, drawn from the same data.
                A section that only has sentences about a shape should show it. */}
            {visual(p.id)}
          </section>
        ))}
      </div>

      <p className="mt-10 max-w-[68ch] border-t border-line pt-6 text-[13px] leading-relaxed text-muted">
        {dict.brief.method}
      </p>
    </article>
  );
}
