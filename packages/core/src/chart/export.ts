/**
 * Naming and attribution for an exported chart image.
 *
 * A chart screenshot outlives the tab it came from — it gets pasted into a Zalo
 * group months later — so the picture has to say what it is on its own. The
 * footer is the whole acquisition loop: a reader shares their analysis, and the
 * image carries where it came from.
 *
 * Pure so the wording and the filename are testable without a canvas.
 */
export interface ExportMeta {
  symbol: string;
  /** Timeframe id as the chart shows it, e.g. "1D". */
  tf: string;
  at: Date;
  /** Origin to credit. Omitted for tiers that paid for a clean image. */
  site?: string | null;
}

/** `YYYY-MM-DD` in Ho Chi Minh time — the market's day, not the viewer's. */
function ymd(at: Date): string {
  const shifted = new Date(at.getTime() + 7 * 3600 * 1000);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const d = String(shifted.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * A filename that sorts usefully in a downloads folder and cannot escape it.
 * Everything outside the allowed set is dropped rather than substituted, so two
 * different symbols can never collapse to one name.
 */
export function exportFilename({ symbol, tf, at }: ExportMeta): string {
  const safe = (v: string) => v.replace(/[^A-Za-z0-9]/g, "").slice(0, 16);
  return `${safe(symbol.toUpperCase()) || "CHART"}-${safe(tf) || "1D"}-${ymd(at)}.png`;
}

/**
 * The single line burned into the bottom of the image. `null` when the reader's
 * tier bought a clean export — the credit is what the free tier trades for the
 * feature, and charging for it while still stamping it would be taking twice.
 */
export function footerText({ symbol, tf, at, site }: ExportMeta): string | null {
  if (!site) return null;
  const host = site.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return `${symbol.toUpperCase()} · ${tf} · ${ymd(at)} · ${host}`;
}
