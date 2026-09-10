/**
 * Corporate events on the price axis — dividends, stock dividends, rights issues.
 *
 * WHAT THE MARKER MAY CLAIM, and it is narrower than it looks. The daily series
 * we chart is back-adjusted: probing VNM's 2025-10-16 (2,500 đ/cp) and
 * 2026-06-26 (1,850 đ/cp) ex-dates against DNSE showed the previous close and
 * the ex-day open within 0.35 of each other, where an unadjusted series would
 * have gapped by the full dividend. So a marker here explains NOTHING about a
 * drop on the chart — there is no drop to explain. It answers a different and
 * still useful question: "was I holding this when it paid, and how much?"
 * Wording that implies causation would be wrong, so the labels state the event
 * and the amount, never a reason.
 *
 * Pure: parsing and placement are testable without a network.
 */

/** Types the feed publishes that actually change what a holder receives. */
export type EventKind = "cash" | "stock" | "rights";

export interface CorpEvent {
  /** Ex-right date (ngày GDKHQ) as `YYYY-MM-DD` in exchange local time. */
  exDate: string;
  kind: EventKind;
  /** Cash per share in VND. Null for non-cash events. */
  cash: number | null;
  /** Ratio as the feed reports it — percent for cash, per-100 for stock. */
  ratio: number | null;
  /** The feed's own description, already localised by the row we kept. */
  note: string;
}

/**
 * Raw row shape from VNDirect finfo v4 `/events`. Every field is optional
 * because it is an unofficial endpoint: a row missing what we need is dropped,
 * never defaulted into a confident wrong number.
 */
export interface RawEvent {
  code?: string;
  type?: string;
  group?: string;
  note?: string;
  dividend?: number;
  ratio?: number;
  effectiveDate?: string;
  locale?: string;
}

/**
 * Feed type → what it means for a holder.
 *
 * `schedDiv` is deliberately absent: it is the feed's *expected* dividend, not a
 * declared one, and a marker on the chart is a statement of fact. `MEETING`,
 * `LISTED` and the stockAlert rows are not events against a share.
 */
const KIND_OF: Record<string, EventKind> = {
  DIVIDEND: "cash",
  STOCKDIV: "stock",
  KINDDIV: "stock",
  ISSUE: "rights",
};

/** A single glyph per kind, so the marker never depends on colour. */
export const EVENT_GLYPH: Record<EventKind, string> = {
  cash: "D",
  stock: "S",
  rights: "R",
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Normalise a feed page into events worth drawing.
 *
 * The feed returns THE SAME event twice, once per locale (`…​.VN` and
 * `…​.EN_GB`), so a naive pass draws every dividend on top of itself. Rows are
 * deduped on (date, kind, cash), preferring the row whose locale matches the
 * reader so the note is in their language.
 */
export function parseEvents(rows: RawEvent[], locale: "vi" | "en"): CorpEvent[] {
  const want = locale === "vi" ? "VN" : "EN_GB";
  const byKey = new Map<string, { ev: CorpEvent; exact: boolean }>();

  for (const r of rows ?? []) {
    const kind = KIND_OF[r.type ?? ""];
    if (!kind) continue;
    const exDate = r.effectiveDate;
    if (!exDate || !ISO_DATE.test(exDate)) continue;

    const cash = typeof r.dividend === "number" && Number.isFinite(r.dividend) ? r.dividend : null;
    const ratio = typeof r.ratio === "number" && Number.isFinite(r.ratio) ? r.ratio : null;
    const key = `${exDate}|${kind}|${cash ?? ""}`;
    const exact = r.locale === want;
    const prev = byKey.get(key);
    // First row wins unless a later one is in the reader's own language.
    if (prev && (prev.exact || !exact)) continue;
    byKey.set(key, { ev: { exDate, kind, cash, ratio, note: (r.note ?? "").trim() }, exact });
  }

  return [...byKey.values()].map((v) => v.ev).sort((a, b) => a.exDate.localeCompare(b.exDate));
}

/** `YYYY-MM-DD` for a unix second, read in exchange local time. */
/**
 * Built once, at module load.
 *
 * `Intl.DateTimeFormat` is expensive to CONSTRUCT — it resolves a locale and a
 * time zone — and cheap to reuse. Building one per call cost 4.1ms for the 120
 * bars of a default window, a quarter of a frame, on every frame of a pan,
 * because the events layer re-derives its placements as the window moves.
 */
const ICT_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Ho_Chi_Minh",
  year: "numeric", month: "2-digit", day: "2-digit",
});

export function ictDay(tSec: number): string {
  return ICT_DAY.format(new Date(tSec * 1000));
}

export interface PlacedEvent extends CorpEvent {
  /** Index into the bar array the marker sits on. */
  i: number;
}

/**
 * Place events onto the visible bars.
 *
 * An event is drawn only when its ex-date IS a bar in view. Snapping to the
 * nearest bar instead would silently park a dividend from outside the window on
 * the first or last candle, which reads as a real event on the wrong day —
 * exactly the kind of confidently-wrong mark this codebase avoids elsewhere.
 */
export function placeEvents(bars: { t: number }[], events: CorpEvent[]): PlacedEvent[] {
  if (!bars.length || !events.length) return [];
  const index = new Map<string, number>();
  // Last bar wins for a day: intraday windows repeat a day across many bars and
  // the marker belongs at the session's end, not its open.
  bars.forEach((b, i) => index.set(ictDay(b.t), i));

  const out: PlacedEvent[] = [];
  for (const ev of events) {
    const i = index.get(ev.exDate);
    if (i === undefined) continue;
    out.push({ ...ev, i });
  }
  return out;
}
