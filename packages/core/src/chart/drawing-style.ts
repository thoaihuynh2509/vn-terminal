/** A drawing's look, as TradingView's floating toolbar sets it; an absent field falls back to the tool's default. */
export interface DrawingStyle {
  color?: string;
  width?: 1 | 2 | 3 | 4;
  dash?: "solid" | "dashed" | "dotted";
}

export const STYLE_COLORS = ["#2962ff", "#089981", "#f23645", "#ff9800", "#9c27b0", "#00bcd4", "#787b86", "#131722"] as const;
export type StyleColor = (typeof STYLE_COLORS)[number];
export const STYLE_WIDTHS = [1, 2, 3, 4] as const;
export const STYLE_DASHES = ["solid", "dashed", "dotted"] as const;

const HEX = /^#[0-9a-f]{6}$/i;

/** A stored style keeps only its valid parts; storage is reader-owned, so nothing in it is trusted. */
export function sanitizeStyle(v: unknown): DrawingStyle | undefined {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  const out: DrawingStyle = {};
  if (typeof o.color === "string" && HEX.test(o.color)) out.color = o.color.toLowerCase();
  if (o.width === 1 || o.width === 2 || o.width === 3 || o.width === 4) out.width = o.width;
  if (o.dash === "solid" || o.dash === "dashed" || o.dash === "dotted") out.dash = o.dash;
  return Object.keys(out).length ? out : undefined;
}

export function dashPattern(dash: DrawingStyle["dash"]): number[] {
  return dash === "dashed" ? [6, 4] : dash === "dotted" ? [1.5, 3] : [];
}
