/**
 * Row-level trend glyph. Deliberately has no axis, no tooltip and no label: it
 * sits beside the numeric price and change in the same row, which carry the
 * actual values. Marked aria-hidden so a screen reader gets the numbers once,
 * not a meaningless path description.
 */
export function Sparkline({
  points,
  dir,
  width = 88,
  height = 26,
}: {
  points: number[];
  dir: "up" | "down" | "flat";
  width?: number;
  height?: number;
}) {
  if (!points || points.length < 2) return <span className="text-muted">—</span>;

  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const pad = 2;
  const w = width - pad * 2;
  const h = height - pad * 2;

  const d = points
    .map((p, i) => {
      const x = pad + (i / (points.length - 1)) * w;
      const y = pad + h - ((p - min) / span) * h;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  const stroke = dir === "up" ? "var(--up)" : dir === "down" ? "var(--down)" : "var(--muted)";

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" focusable="false">
      <path d={d} fill="none" stroke={stroke} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
