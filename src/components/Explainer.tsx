import type { Explainer as ExplainerContent } from "@/content/explainers";
import { Accordion } from "./layout";
import { JsonLd } from "./JsonLd";

/**
 * The evergreen essay under each board, folded shut.
 *
 * It exists for search engines and first-time readers; a returning reader wants
 * the table. A closed <details> keeps the text in the HTML — crawlers and the FAQ
 * schema still see all of it — without spending half the page on it.
 */
export function Explainer({ content }: { content: ExplainerContent }) {
  return (
    <section className="mt-8" aria-labelledby="explainer-title">
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: content.faqs.map((f) => ({
            "@type": "Question",
            name: f.q,
            acceptedAnswer: { "@type": "Answer", text: f.a },
          })),
        }}
      />

      <Accordion title={<h2 id="explainer-title" className="text-[14px] font-semibold tracking-tight">{content.title}</h2>}>
        <p className="max-w-[68ch] text-[14px] leading-relaxed text-ink-2">{content.intro}</p>

        <div className="mt-6 grid gap-6 lg:grid-cols-3">
          {content.sections.map((s) => (
            <div key={s.heading}>
              <h3 className="text-[14px] font-semibold">{s.heading}</h3>
              {s.body.map((p, i) => (
                <p key={i} className="mt-2 max-w-[68ch] text-[13px] leading-relaxed text-ink-2">
                  {p}
                </p>
              ))}
            </div>
          ))}
        </div>

        <div className="mt-8">
          <h3 className="text-[14px] font-semibold">FAQ</h3>
          <dl className="mt-3 max-w-[80ch]">
            {content.faqs.map((f) => (
              <div key={f.q} className="border-b border-line py-3 last:border-0">
                <dt className="text-[13px] font-medium">{f.q}</dt>
                <dd className="mt-1 text-[13px] leading-relaxed text-ink-2">{f.a}</dd>
              </div>
            ))}
          </dl>
        </div>
      </Accordion>
    </section>
  );
}
