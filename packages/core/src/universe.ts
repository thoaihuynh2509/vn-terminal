/**
 * Which exchange a symbol is listed on.
 *
 * This exists for one reason: the daily price limit differs by exchange — HOSE
 * ±7%, HNX ±10%, UPCOM ±15% — and the chart draws those limits as the ceiling
 * and floor lines a Vietnamese trader checks first. Drawing HOSE's band on an
 * HNX stock is not a cosmetic error; it is a wrong number in the place readers
 * trust most, which is exactly what the chart previously did for every symbol.
 *
 * MAINTENANCE, stated plainly: no feed we use publishes a per-symbol exchange,
 * so this is a hand-kept table and it goes stale. Companies move between
 * exchanges — usually UPCOM to HOSE — and a symbol listed here under its old
 * exchange produces a confidently wrong band.
 *
 * That is why `exchangeOf` returns NULL rather than guessing, and why the caller
 * draws nothing when it does. A missing pair of lines is a gap the reader can
 * see; a wrong pair is one they cannot. Only add a symbol you are sure of.
 *
 * Coverage was probed against the bars feed before listing (2026-09-07): every
 * symbol here returns real daily bars, and a nonsense control returned none.
 */
export type Exchange = "HOSE" | "HNX" | "UPCOM";

/** Daily price-limit band, as a fraction, per exchange. */
export const EXCHANGE_BAND: Record<Exchange, number> = {
  HOSE: 0.07,
  HNX: 0.10,
  UPCOM: 0.15,
};

/** The VN30 basket — HOSE by definition. */
export const HOSE_SYMBOLS = [
  "ACB", "BCM", "BID", "BVH", "CTG", "FPT", "GAS", "GVR", "HDB", "HPG",
  "MBB", "MSN", "MWG", "PLX", "POW", "SAB", "SHB", "SSB", "SSI", "STB",
  "TCB", "TPB", "VCB", "VHM", "VIB", "VIC", "VJC", "VNM", "VPB", "VRE",
] as const;

/** Liquid HNX names. Long-settled listings; none of these are recent movers. */
export const HNX_SYMBOLS = [
  "SHS", "PVS", "CEO", "IDC", "MBS", "VCS", "TNG", "HUT", "PVI", "BVS",
  "DTD", "LAS", "NTP", "PLC", "PVC", "TIG", "VGS", "DXP", "IDJ", "AMV",
  "VC3", "L18", "SLS", "MST",
] as const;

/**
 * Liquid UPCOM names.
 *
 * Deliberately shorter than the probe found. Several symbols that returned bars
 * — BSR, VTP, CTR, SIP — have moved to HOSE at some point, and listing one under
 * the wrong exchange is worse than omitting it, so anything uncertain is left
 * out and simply gets no band.
 */
export const UPCOM_SYMBOLS = [
  "ACV", "VEA", "QNS", "MCH", "VGI", "MSR", "OIL", "VGT",
  "FOX", "MPC", "DDV", "BVB", "ABI", "SGB",
] as const;

const BY_SYMBOL = new Map<string, Exchange>([
  ...HOSE_SYMBOLS.map((s) => [s, "HOSE"] as const),
  ...HNX_SYMBOLS.map((s) => [s, "HNX"] as const),
  ...UPCOM_SYMBOLS.map((s) => [s, "UPCOM"] as const),
]);

/** Every symbol we can chart with a known exchange, sorted. */
export const ALL_SYMBOLS: string[] = [...BY_SYMBOL.keys()].sort();

/** The exchange, or `null` when we do not know — never a guess. */
export function exchangeOf(symbol: string): Exchange | null {
  return BY_SYMBOL.get(symbol.toUpperCase()) ?? null;
}

/**
 * The price-limit band for a symbol, or `null` when the exchange is unknown.
 * A caller that gets null must draw no ceiling/floor rather than fall back.
 */
export function bandOf(symbol: string): number | null {
  const ex = exchangeOf(symbol);
  return ex ? EXCHANGE_BAND[ex] : null;
}
