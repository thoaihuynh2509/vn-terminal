import type { Dict } from "@/lib/i18n";

/** Degraded-feed notice. Shown when a provider threw — the page still renders
 *  whatever it has, but never presents a gap as if it were real data. */
export function FeedBanner({ dict, detail }: { dict: Dict; detail?: string }) {
  return (
    <div role="status" className="mb-4 rounded border border-line bg-surface px-3 py-2.5">
      <p className="text-[13px] font-medium text-ink">⚠ {dict.common.unavailable}</p>
      <p className="mt-0.5 text-[12px] text-ink-2">{dict.common.unavailableHint}</p>
      {detail && <p className="mt-1 font-mono text-[11px] text-muted">{detail}</p>}
    </div>
  );
}
