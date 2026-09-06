/**
 * Emits schema.org JSON-LD. Answer engines and rich results read this; it is the
 * cheapest structured surface a data-first site can offer, and the reference
 * site leaves it largely on the table.
 */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      // Content is authored in-repo, never user input.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}
