import { ImageResponse } from "next/og";
import { BRAND } from "@/lib/brand";
import { getTimeframeBars } from "@/lib/providers/vnstock";
import { chartSource } from "@/lib/chart/series";

export const runtime = "nodejs";
export const alt = "Chart";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * The card a shared chart link unfurls into.
 *
 * A link to a chart currently previews as the site's generic card, which tells a
 * reader in a Zalo group nothing about what was shared and gives them no reason
 * to open it. This draws the symbol, its last price with a direction glyph, and
 * a simplified line of the recent close.
 *
 * `next/og` is built in, so this adds no dependency. Rendered on demand and
 * cached by the platform.
 *
 * Direction is carried by a GLYPH as well as colour, exactly as it is in the
 * app: these cards are re-shared as screenshots, and a red-green-only signal
 * does not survive that or a colour-blind reader.
 */
export default async function Image({
  params,
}: {
  params: Promise<{ symbol: string }>;
}) {
  const { symbol } = await params;
  const sym = decodeURIComponent(symbol).toUpperCase();

  let bars: { t: number; c: number }[] = [];
  try {
    // Only equities have a feed to draw from here; a recorded series or a coin
    // gets the plain card rather than a wrong one.
    if (chartSource(sym).kind === "equity") {
      bars = (await getTimeframeBars(sym, "1D")).slice(-90);
    }
  } catch {
    /* a dead feed still gets a card, just without the sparkline */
  }

  const last = bars[bars.length - 1]?.c ?? null;
  const prev = bars[bars.length - 2]?.c ?? last;
  const changePct = last !== null && prev ? ((last - prev) / prev) * 100 : 0;
  const up = changePct >= 0;

  // The polyline, normalised into the card's own box.
  let path = "";
  if (bars.length > 1) {
    const vals = bars.map((b) => b.c);
    const lo = Math.min(...vals), hi = Math.max(...vals);
    const span = hi - lo || 1;
    path = bars
      .map((b, i) => {
        const x = 80 + (i / (bars.length - 1)) * 1040;
        const y = 470 - ((b.c - lo) / span) * 180;
        return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%", height: "100%", display: "flex", flexDirection: "column",
          background: "#0b0d10", color: "#e8eaed", padding: "64px 80px",
          fontFamily: "sans-serif", justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontSize: 88, fontWeight: 700, letterSpacing: -2 }}>{sym}</div>
          {last !== null && (
            <div style={{ display: "flex", alignItems: "baseline", gap: 20 }}>
              <span style={{ fontSize: 56, fontWeight: 600 }}>{last.toFixed(2)}</span>
              <span style={{ fontSize: 36, color: up ? "#16a34a" : "#dc2626" }}>
                {up ? "▲" : "▼"} {up ? "+" : ""}{changePct.toFixed(2)}%
              </span>
            </div>
          )}
        </div>

        {path && (
          <svg width="1200" height="240" viewBox="0 0 1200 540" style={{ position: "absolute", left: 0, top: 180 }}>
            <path d={path} fill="none" stroke={up ? "#16a34a" : "#dc2626"} strokeWidth="4" />
          </svg>
        )}

        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 26, color: "#9aa0a6" }}>
          <span>{BRAND.name}</span>
          <span>{last === null ? "" : "1D"}</span>
        </div>
      </div>
    ),
    size,
  );
}
