/** The chart's look, as TradingView's settings dialog sets it. An empty colour means the theme's own. */
export interface Appearance {
  upColor: string;
  downColor: string;
  grid: boolean;
  /** Snap the crosshair, and the points a drawing tool places, to the nearest open, high, low or close. */
  magnet: boolean;
  volume: boolean;
}

export const DEFAULT_APPEARANCE: Appearance = { upColor: "", downColor: "", grid: true, magnet: false, volume: true };

const HEX = /^#[0-9a-f]{6}$/i;
const colour = (v: unknown) => (typeof v === "string" && HEX.test(v) ? v.toLowerCase() : "");
const flag = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);

/** The open, high, low or close nearest a price: where the magnet puts a point. */
export function snapToBar(bar: { o: number; h: number; l: number; c: number }, price: number): number {
  return [bar.o, bar.h, bar.l, bar.c].reduce((best, v) => (Math.abs(v - price) < Math.abs(best - price) ? v : best));
}

/** Tolerant: a corrupt or partial blob yields the defaults for whatever it lacks. */
export function parseAppearance(v: unknown): Appearance {
  if (!v || typeof v !== "object") return DEFAULT_APPEARANCE;
  const o = v as Record<string, unknown>;
  return {
    upColor: colour(o.upColor),
    downColor: colour(o.downColor),
    grid: flag(o.grid, DEFAULT_APPEARANCE.grid),
    magnet: flag(o.magnet, DEFAULT_APPEARANCE.magnet),
    volume: flag(o.volume, DEFAULT_APPEARANCE.volume),
  };
}
