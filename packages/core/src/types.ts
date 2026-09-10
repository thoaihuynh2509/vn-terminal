export type Locale = "vi" | "en";

/** Direction of a value against its reference. `flat` renders as neutral ink. */
export type Dir = "up" | "down" | "flat";

export interface Quote {
  symbol: string;
  name?: string;
  price: number;
  change: number;
  changePct: number;
  /** Session volume in shares. Absent for feeds that do not publish it. */
  volume?: number;
  high?: number;
  low?: number;
  open?: number;
  prevClose?: number;
  /** Recent closes for a row-level trend glyph. */
  spark?: number[];
}

export interface Bar {
  t: number; // unix seconds
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface GoldRow {
  code: string;
  name: string;
  buy: number;
  sell: number;
  changeBuy: number;
  changeSell: number;
  currency: "VND" | "USD";
}

export interface GoldSnapshot {
  rows: GoldRow[];
  world?: GoldRow;
  updatedAt: string;
  date: string;
}

/** A provider failure that the UI must render as a degraded state, never as zeros. */
export class FeedError extends Error {
  constructor(
    public readonly feed: string,
    message: string,
  ) {
    super(`[${feed}] ${message}`);
    this.name = "FeedError";
  }
}

/** Re-exported so components can type a tier without reaching into auth internals. */
export type { Tier } from "./auth/entitlement";
