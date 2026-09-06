import type { Quote } from "./types";

/**
 * VN30 sector map.
 *
 * Sector performance is the single most useful thing that can be computed from a
 * board and is not published free anywhere in Vietnamese — it is the sort of
 * original analysis a reader will pay for, unlike translated wire copy which is
 * already free from CafeF and Vietstock.
 *
 * Groupings follow how Vietnamese desks actually talk about VN30 (ngân hàng,
 * bất động sản, ...), not GICS.
 */
export type SectorKey = "bank" | "realestate" | "retail" | "industrial" | "energy" | "other";

const MAP: Record<string, SectorKey> = {
  ACB: "bank", BID: "bank", CTG: "bank", HDB: "bank", MBB: "bank", SHB: "bank",
  SSB: "bank", STB: "bank", TCB: "bank", TPB: "bank", VCB: "bank", VIB: "bank", VPB: "bank",
  BCM: "realestate", KDH: "realestate", VHM: "realestate", VIC: "realestate", VRE: "realestate",
  MSN: "retail", MWG: "retail", PNJ: "retail", SAB: "retail", VNM: "retail",
  FPT: "industrial", GVR: "industrial", HPG: "industrial", VJC: "industrial",
  GAS: "energy", PLX: "energy", POW: "energy",
  BVH: "other", SSI: "other",
};

export const SECTOR_LABEL: Record<SectorKey, { vi: string; en: string }> = {
  bank: { vi: "Ngân hàng", en: "Banks" },
  realestate: { vi: "Bất động sản", en: "Real estate" },
  retail: { vi: "Tiêu dùng & bán lẻ", en: "Consumer & retail" },
  industrial: { vi: "Công nghiệp & công nghệ", en: "Industrials & tech" },
  energy: { vi: "Năng lượng", en: "Energy" },
  other: { vi: "Khác", en: "Other" },
};

export function sectorOf(symbol: string): SectorKey {
  return MAP[symbol] ?? "other";
}

export interface SectorStat {
  key: SectorKey;
  count: number;
  /** Turnover-weighted average change — a big name moving matters more. */
  weightedChangePct: number;
  advancing: number;
  declining: number;
  turnover: number;
}

/**
 * Weighted by traded value rather than a plain mean: an equal-weight average
 * lets a small illiquid name swing a sector it barely trades in.
 */
export function sectorStats(board: Quote[]): SectorStat[] {
  const groups = new Map<SectorKey, Quote[]>();
  for (const q of board) {
    const k = sectorOf(q.symbol);
    groups.set(k, [...(groups.get(k) ?? []), q]);
  }

  const out: SectorStat[] = [];
  for (const [key, quotes] of groups) {
    const turnover = quotes.reduce((s, q) => s + (q.volume ?? 0) * q.price, 0);
    const weighted =
      turnover > 0
        ? quotes.reduce((s, q) => s + q.changePct * ((q.volume ?? 0) * q.price), 0) / turnover
        : quotes.reduce((s, q) => s + q.changePct, 0) / (quotes.length || 1);
    out.push({
      key,
      count: quotes.length,
      weightedChangePct: weighted,
      advancing: quotes.filter((q) => q.changePct > 0).length,
      declining: quotes.filter((q) => q.changePct < 0).length,
      turnover,
    });
  }
  return out.sort((a, b) => b.weightedChangePct - a.weightedChangePct);
}

/**
 * Breadth divergence: the index direction disagreeing with the majority of its
 * constituents. Worth stating plainly because it is easy to miss from a headline
 * number, and it is a description of what happened — not a forecast.
 */
export function breadthDivergence(indexChangePct: number, board: Quote[]): "none" | "narrow-rally" | "narrow-selloff" {
  const up = board.filter((q) => q.changePct > 0).length;
  const down = board.filter((q) => q.changePct < 0).length;
  if (indexChangePct > 0 && down > up) return "narrow-rally";
  if (indexChangePct < 0 && up > down) return "narrow-selloff";
  return "none";
}

/** Where the money actually went, regardless of headline percentage moves. */
export function turnoverLeaders(board: Quote[], n = 3): Quote[] {
  return [...board]
    .sort((a, b) => (b.volume ?? 0) * b.price - (a.volume ?? 0) * a.price)
    .slice(0, n);
}
