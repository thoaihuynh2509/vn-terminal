import { Accordion } from "./layout";
import { JsonLd } from "./JsonLd";
import { faqPageLd, symbolNarrative } from "@/lib/seo/narrative";
import type { NarrativeInput } from "@/lib/seo/narrative";
import type { Dict } from "@/lib/i18n";

/**
 * The prose under a symbol's chart, mirroring `Explainer` on the boards.
 *
 * Folded shut for the same reason: a returning reader wants the chart, while a
 * crawler and a first-time visitor want a sentence. A closed <details> keeps
 * every word in the HTML.
 *
 * Nothing here is written by hand — `symbolNarrative` restates figures the page
 * already loaded, and drops any sentence whose input is missing.
 */
export function SymbolNarrative({ dict, input }: { dict: Dict; input: NarrativeInput }) {
  const { paragraphs, faq } = symbolNarrative(input);
  if (!paragraphs.length && !faq.length) return null;

  const title = dict.chart.aboutTitle.replace("{symbol}", input.symbol);
  const faqTitle = dict.chart.faqTitle.replace("{symbol}", input.symbol);

  return (
    <section className="mt-8" aria-labelledby="symbol-narrative-title">
      {/* Only the stable half reaches the graph: exchange, band, membership and
          what this page offers. No price — the feed may lag, and a number here
          is a claim to a machine that will repeat it. */}
      {faq.length > 0 && <JsonLd data={faqPageLd(faq)} />}

      <Accordion
        title={<h2 id="symbol-narrative-title" className="text-[14px] font-semibold tracking-tight">{title}</h2>}
      >
        {paragraphs.length > 0 && (
          <>
            {paragraphs.map((p, i) => (
              <p key={i} className="mt-2 max-w-[68ch] text-[13px] leading-relaxed text-ink-2 first:mt-0">
                {p}
              </p>
            ))}
            <p className="mt-4 max-w-[68ch] text-[12px] leading-relaxed text-ink-2">{dict.chart.aboutNote}</p>
          </>
        )}

        {faq.length > 0 && (
          <div className="mt-8">
            <h3 className="text-[14px] font-semibold">{faqTitle}</h3>
            <dl className="mt-3 max-w-[80ch]">
              {faq.map((f) => (
                <div key={f.q} className="border-b border-line py-3 last:border-0">
                  <dt className="text-[13px] font-medium">{f.q}</dt>
                  <dd className="mt-1 text-[13px] leading-relaxed text-ink-2">{f.a}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}
      </Accordion>
    </section>
  );
}
