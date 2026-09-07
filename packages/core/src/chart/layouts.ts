/**
 * Saved chart setups — "my four-chart bank screen", recalled by name.
 *
 * `LAYOUT_LIMIT` has existed in `entitlement.ts` since before the roadmap, and
 * the server half shipped with `/api/docs`, but nothing ever wrote one: the cap
 * was enforced against writes that could not happen. This is the consumer.
 *
 * A layout is stored as FIELDS, not as a URL. Keeping the href would be less
 * code and two things worse: a stored link is an open-redirect waiting for
 * someone to hand-edit local storage, and a route change would silently break
 * every saved setup instead of merely renaming a parameter. `layoutQuery`
 * rebuilds the address from the fields, so the URL format stays owned by the
 * code that reads it.
 *
 * Pure — the cap, the merge and the naming rules are all testable without a
 * browser or a database.
 */
import { LAYOUT_LIMIT, type Tier } from "../auth/entitlement.ts";
import type { RangePreset } from "./ranges.ts";
import { DEFAULT_SCALE, isScale, type ScaleId } from "./scale.ts";
import type { ChartTypeId } from "./view-state.ts";

export interface SavedLayout {
  /** Reader-chosen, and the document key on the server. */
  name: string;
  symbol: string;
  /** Companion symbols for a 2/4 grid. */
  extra: string[];
  grid: 1 | 2 | 4;
  tf: string;
  type: ChartTypeId;
  /** Indicator tokens (`rsi`, `rsi:21`). */
  ind: string[];
  range: RangePreset | null;
  /** Price axis. */
  scale: ScaleId;
  /** Compare overlay symbols. */
  cmp: string[];
  /** Foreign-flow pane. */
  fr: boolean;
  /** Breadth pane. */
  br: boolean;
  /** Unix ms — the tiebreaker when two devices saved the same name. */
  savedAt: number;
}

/** Where a reader's setups live in this browser. */
export const LAYOUTS_KEY = "layouts";

/**
 * Mirrors the CHECK constraint on `user_docs.key` (migration 006) exactly,
 * because a name that this accepts and the database rejects would look like a
 * save that worked and then vanished on the next device.
 */
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 _.-]{0,63}$/;

export function isValidName(name: string): boolean {
  return NAME_RE.test(name);
}

/** Trim and collapse whitespace; the reader typed a name, not a key. */
export function normaliseName(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").slice(0, 64);
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const strArr = (v: unknown, cap: number): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, cap) : [];

/**
 * Read one stored layout, or `null` if it is not one.
 *
 * Everything is defaulted rather than trusted: this parses local storage and a
 * server row, and a layout written by a newer build must degrade to a chart
 * that opens rather than throwing on the rail.
 */
export function parseLayout(v: unknown): SavedLayout | null {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const name = normaliseName(str(o.name));
  const symbol = str(o.symbol).toUpperCase();
  if (!isValidName(name) || !symbol) return null;
  const grid = o.grid === 2 || o.grid === 4 ? (o.grid as 2 | 4) : 1;
  return {
    name,
    symbol,
    extra: strArr(o.extra, 3).map((s) => s.toUpperCase()),
    grid,
    tf: str(o.tf) || "1D",
    type: o.type === "line" || o.type === "area" ? o.type : "candle",
    ind: strArr(o.ind, 40),
    range: typeof o.range === "string" ? (o.range as RangePreset) : null,
    scale: isScale(o.scale) ? o.scale : DEFAULT_SCALE,
    cmp: strArr(o.cmp, 3).map((s) => s.toUpperCase()),
    fr: o.fr === true,
    br: o.br === true,
    savedAt: typeof o.savedAt === "number" && Number.isFinite(o.savedAt) ? o.savedAt : 0,
  };
}

export function parseLayouts(raw: string | null): SavedLayout[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    const out: SavedLayout[] = [];
    const seen = new Set<string>();
    for (const item of v) {
      const l = parseLayout(item);
      // A name is an identity: the newer save of a duplicated name wins.
      if (!l || seen.has(l.name)) continue;
      seen.add(l.name);
      out.push(l);
    }
    return out;
  } catch {
    return [];
  }
}

export function serializeLayouts(list: SavedLayout[]): string {
  return JSON.stringify(list);
}

export type SaveError = "bad_name" | "limit";

export interface SaveResult {
  ok: boolean;
  error?: SaveError;
  limit?: number;
  list?: SavedLayout[];
}

/**
 * Add or replace a layout, honouring the tier's ceiling.
 *
 * Re-saving a name already stored is an UPDATE and is allowed at the cap —
 * otherwise the last slot silently becomes read-only, which reads as a bug
 * rather than as a limit. This mirrors the rule `validateDoc` applies on the
 * server, where `setupCount` excludes the key being written.
 */
export function upsertLayout(list: SavedLayout[], next: SavedLayout, tier: Tier): SaveResult {
  if (!isValidName(next.name)) return { ok: false, error: "bad_name" };
  const limit = LAYOUT_LIMIT[tier];
  const at = list.findIndex((l) => l.name === next.name);
  if (at === -1 && list.length >= limit) return { ok: false, error: "limit", limit };
  const out = at === -1 ? [...list, next] : list.map((l, i) => (i === at ? next : l));
  return { ok: true, list: sortLayouts(out) };
}

export function removeLayout(list: SavedLayout[], name: string): SavedLayout[] {
  return list.filter((l) => l.name !== name);
}

/** Newest first: the setup a reader is iterating on stays at the top. */
export function sortLayouts(list: SavedLayout[]): SavedLayout[] {
  return [...list].sort((a, b) => b.savedAt - a.savedAt || a.name.localeCompare(b.name));
}

/**
 * Combine this browser's layouts with the account's.
 *
 * Union by name, newest `savedAt` winning — a reader who saved on their phone
 * and their desktop must end up with both, and re-saving the same name on one
 * device must not resurrect the older copy from the other. Ties keep the local
 * copy, so a merge can never make the screen change under the reader for a
 * layout that is byte-identical anyway.
 */
export function mergeLayouts(local: SavedLayout[], remote: SavedLayout[]): SavedLayout[] {
  const by = new Map<string, SavedLayout>();
  for (const l of remote) by.set(l.name, l);
  for (const l of local) {
    const r = by.get(l.name);
    if (!r || l.savedAt >= r.savedAt) by.set(l.name, l);
  }
  return sortLayouts([...by.values()]);
}

/**
 * The query string that reproduces a layout, minus the leading `?`.
 *
 * Defaults are omitted so a plain saved chart recalls to a clean URL rather than
 * one carrying its own defaults — the same rule `encodeView` follows.
 */
export function layoutQuery(l: SavedLayout): string {
  const p = new URLSearchParams();
  if (l.tf && l.tf !== "1D") p.set("tf", l.tf);
  if (l.grid !== 1) {
    p.set("layout", String(l.grid));
    if (l.extra.length) p.set("s", l.extra.join(","));
  }
  if (l.type !== "candle") p.set("type", l.type);
  if (l.ind.length) p.set("ind", l.ind.join(","));
  if (l.range) p.set("r", l.range);
  if (l.scale !== DEFAULT_SCALE) p.set("sc", l.scale);
  if (l.cmp.length) p.set("cmp", l.cmp.join(","));
  if (l.fr) p.set("fr", "1");
  if (l.br) p.set("br", "1");
  return p.toString();
}

/**
 * Capture a layout from the address bar.
 *
 * The URL is already the single source of truth for what the chart is showing —
 * P1-12 made `ChartPro` write type, indicators and range back to it — so reading
 * the address is how a "save this setup" button stays correct without the rail
 * having to reach into the chart's internals for state it does not own.
 *
 * Deliberately the exact inverse of `layoutQuery`, so a captured layout recalls
 * to the chart it was captured from; the round trip is asserted in the tests.
 */
export function layoutFromQuery(
  name: string,
  symbol: string,
  search: string,
  savedAt: number,
): SavedLayout | null {
  const p = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const n = Number(p.get("layout"));
  const grid = n === 2 || n === 4 ? (n as 2 | 4) : 1;
  const list = (v: string | null, cap: number) =>
    (v ?? "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean).slice(0, cap);
  return parseLayout({
    name,
    symbol,
    // A one-up chart renders no companions, so storing them would save symbols
    // nothing shows.
    extra: grid === 1 ? [] : list(p.get("s"), 3),
    grid,
    tf: p.get("tf") ?? "1D",
    type: p.get("type") ?? "candle",
    ind: (p.get("ind") ?? "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 40),
    range: p.get("r"),
    scale: p.get("sc"),
    cmp: list(p.get("cmp"), 3),
    fr: p.get("fr") === "1",
    br: p.get("br") === "1",
    savedAt,
  });
}
