/**
 * The daily brief, frozen as a document.
 *
 * The live brief is composed from feeds that publish only "now". Re-render
 * yesterday's page tomorrow and it silently shows tomorrow's numbers under
 * yesterday's date — which is exactly why /ban-tin was one URL and the site
 * had no publishing history to index. A snapshot is what makes a dated page
 * honest, and sixty of them a month is the cheapest content this site has.
 *
 * Stored as jsonb and read back through `parseSnapshot`, which is tolerant on
 * purpose: a document written by an older deploy must still render rather than
 * throw inside a page that is otherwise fine.
 *
 * Pure. The instant and every figure are passed in.
 */
import { buildBrief, type Brief } from "../brief.ts";
import type { GoldRow, GoldSnapshot, Quote } from "../types.ts";

export const SNAPSHOT_VERSION = 1;

export interface BriefInputs {
  indices: Quote[];
  board: Quote[];
  gold: GoldSnapshot | null;
  goldHeadline?: GoldRow;
  premiumPct?: number;
  /** Index sparklines, by symbol, as the live view fetches them. */
  sparks?: Record<string, number[]>;
}

/**
 * What the archived page needs to draw the same charts the live one drew.
 *
 * Only the series actually rendered are kept. The full board is here because
 * the breadth heatmap and the sector bars are both computed from it, and both
 * are the reason the page is worth reading a month later.
 */
export interface BriefVisuals {
  board: Quote[];
  vnindexSpark?: number[];
  vnindexChangePct?: number;
}

export interface BriefSnapshot {
  v: number;
  /** `YYYY-MM-DD` in Asia/Ho_Chi_Minh. */
  day: string;
  /** ISO instant the snapshot was taken. */
  capturedAt: string;
  vi: Brief;
  en: Brief;
  visuals: BriefVisuals;
}

/**
 * Board rows, without the per-row sparkline.
 *
 * Thirty rows of ~50 closes each is most of the document's weight, and nothing
 * on the archived page draws them — the row glyph is a live-only affordance.
 */
function slimBoard(board: Quote[]): Quote[] {
  return board.map((q) => {
    const slim: Quote = { symbol: q.symbol, price: q.price, change: q.change, changePct: q.changePct };
    if (q.name !== undefined) slim.name = q.name;
    if (q.volume !== undefined) slim.volume = q.volume;
    if (q.high !== undefined) slim.high = q.high;
    if (q.low !== undefined) slim.low = q.low;
    if (q.open !== undefined) slim.open = q.open;
    if (q.prevClose !== undefined) slim.prevClose = q.prevClose;
    return slim;
  });
}

export function composeSnapshot(day: string, inputs: BriefInputs, atMs: number): BriefSnapshot {
  const { indices, board, gold, goldHeadline, premiumPct, sparks } = inputs;
  const args = { indices, board, gold, goldHeadline, premiumPct };

  const vnindex = indices.find((i) => i.symbol === "VNINDEX");
  const vnindexSpark = vnindex ? sparks?.[vnindex.symbol] ?? vnindex.spark : undefined;

  return {
    v: SNAPSHOT_VERSION,
    day,
    capturedAt: new Date(atMs).toISOString(),
    // Both locales are composed now, from the same figures. Composing one and
    // translating later would give the two pages different numbers.
    vi: buildBrief("vi", args),
    en: buildBrief("en", args),
    visuals: {
      board: slimBoard(board),
      ...(vnindexSpark && vnindexSpark.length > 2 ? { vnindexSpark } : {}),
      ...(vnindex ? { vnindexChangePct: vnindex.changePct } : {}),
    },
  };
}

function isBrief(v: unknown): v is Brief {
  if (!v || typeof v !== "object") return false;
  const b = v as Record<string, unknown>;
  return typeof b.headline === "string"
    && typeof b.standfirst === "string"
    && Array.isArray(b.paragraphs);
}

function numbers(v: unknown): number[] | undefined {
  return Array.isArray(v) && v.every((n) => typeof n === "number" && Number.isFinite(n))
    ? (v as number[])
    : undefined;
}

/**
 * Read a stored document, or null if it is not one.
 *
 * Null rather than a throw: the caller renders a 404, which is the right answer
 * for a date whose row is missing OR unreadable. A page that 500s because a
 * document predates a field is a page that takes the whole archive down.
 */
export function parseSnapshot(data: unknown): BriefSnapshot | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (typeof d.day !== "string" || !isBrief(d.vi) || !isBrief(d.en)) return null;

  const rawVisuals = (d.visuals && typeof d.visuals === "object" ? d.visuals : {}) as Record<string, unknown>;
  const board = Array.isArray(rawVisuals.board)
    ? (rawVisuals.board as unknown[]).filter(
        (q): q is Quote => !!q && typeof q === "object" && typeof (q as Quote).symbol === "string",
      )
    : [];

  return {
    v: typeof d.v === "number" ? d.v : 0,
    day: d.day,
    capturedAt: typeof d.capturedAt === "string" ? d.capturedAt : `${d.day}T00:00:00.000Z`,
    vi: d.vi,
    en: d.en,
    visuals: {
      board,
      ...(numbers(rawVisuals.vnindexSpark) ? { vnindexSpark: numbers(rawVisuals.vnindexSpark) } : {}),
      ...(typeof rawVisuals.vnindexChangePct === "number" ? { vnindexChangePct: rawVisuals.vnindexChangePct } : {}),
    },
  };
}
