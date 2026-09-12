const tinted = new Map<string, string>();

/** A token colour with an alpha; tokens resolve to hex or rgb(). */
export function withAlpha(color: string, alpha: number): string {
  const key = `${color}|${alpha}`;
  const hit = tinted.get(key);
  if (hit !== undefined) return hit;
  const out = tint(color, alpha);
  tinted.set(key, out);
  return out;
}

function tint(color: string, alpha: number): string {
  const hex = color.trim().match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
  }
  const rgb = color.trim().match(/^rgba?\(([^)]+)\)$/i);
  if (rgb) {
    const [r, g, b] = rgb[1].split(",").map((v) => v.trim());
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return color;
}
