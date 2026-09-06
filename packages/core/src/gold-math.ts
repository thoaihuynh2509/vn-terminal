/**
 * Pure gold unit maths — no I/O, no imports, so it is directly testable under
 * `node --test` and cannot drift from the values the UI renders.
 */

/* Written as masses so the ratio cannot be inverted by accident. A lượng
   (cây/tael) is 37.5 g; a troy ounce is 31.1035 g. */
export const GRAMS_PER_LUONG = 37.5;
export const GRAMS_PER_TROY_OZ = 31.1035;

/** Troy ounces contained in one lượng ≈ 1.20565 (a lượng is HEAVIER than an oz). */
export const OZ_PER_LUONG = GRAMS_PER_LUONG / GRAMS_PER_TROY_OZ;

/**
 * Domestic-vs-world gold premium, in VND per lượng.
 *
 * A lượng is heavier than a troy ounce, so world price per lượng is the price
 * per ounce MULTIPLIED by OZ_PER_LUONG. Dividing instead understates world
 * parity by ~31% and inflates the premium from a realistic ~5% to a nonsensical
 * ~53% — that bug shipped once, so `premium.test.ts` pins the direction.
 *
 * `usdVnd` is a reference input, not a quote; the UI shows it beside the result.
 */
export function premium(worldUsdPerOz: number, domesticVndPerLuong: number, usdVnd: number) {
  const worldVndPerLuong = worldUsdPerOz * usdVnd * OZ_PER_LUONG;
  const diff = domesticVndPerLuong - worldVndPerLuong;
  return { worldVndPerLuong, diff, pct: (diff / worldVndPerLuong) * 100 };
}
