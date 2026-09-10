/**
 * Prose for a symbol's chart page, derived ENTIRELY from figures the page
 * already loaded.
 *
 * The sixty VN30 chart URLs are the whole long-tail play and, until now, every
 * one of them was a chart and nothing else: no sentence a crawler could read,
 * no answer to the question that brought the reader ("VNM cổ phiếu"). The
 * temptation is to write thirty company descriptions. That would be thirty
 * fabrications on a finance site, so this file cannot do it: every clause below
 * is a restatement of a number in `NarrativeInput`, and a missing input drops
 * its sentence rather than guessing it.
 *
 * Two rules that are not obvious:
 *
 * - Every price sentence carries the date it was true. A description that says
 *   "VNM is trading at 61.2" is stale the next morning and wrong forever after;
 *   "as of 09/09/2026" stays true.
 * - The FAQ that reaches JSON-LD (`stableFaq`) contains only facts that do not
 *   move: exchange, band, index membership, what the page offers. Prices live
 *   in the visible prose, never in the graph — the site's own disclaimer says
 *   the feed may lag, and structured data that can be wrong is worse than none.
 *
 * Pure: no clock, no network, no framework. "Now" is the last recorded bar —
 * every sentence on the page is as of that session, so an event is "upcoming"
 * relative to it too. Reading the wall clock here would also make the function
 * non-deterministic, and its caller a React purity violation.
 */
import { dateOnly } from "../format.ts";
import type { Bar, Locale, Quote } from "../types.ts";
import type { Exchange } from "../universe.ts";

export interface NarrativeFaq {
  q: string;
  a: string;
}

export interface Narrative {
  /** The trading date every price sentence is anchored to, already localised. */
  asOf: string | null;
  paragraphs: string[];
  faq: NarrativeFaq[];
  /** ≤155 characters, for `generateMetadata`. */
  description: string;
}

export interface NarrativeEvent {
  exDate: string;
  cash: number | null;
  note: string;
}

export interface NarrativeForeignDay {
  date: string;
  netVal: number;
}

export interface NarrativeInput {
  symbol: string;
  locale: Locale;
  /** Daily bars, oldest first. Fewer than two means no price sentence at all. */
  bars: Bar[];
  exchange: Exchange | null;
  /** Daily price band as the FRACTION `bandOf()` returns, e.g. 0.07 for HOSE. */
  band: number | null;
  vn30: boolean;
  rsi14?: number;
  foreign?: NarrativeForeignDay[];
  events?: NarrativeEvent[];
}

const LOOKBACK = 250;
const VOLUME_WINDOW = 20;

/** Percent change, guarding the division a flat or absent reference would break. */
function pct(from: number, to: number): number | null {
  if (!Number.isFinite(from) || !Number.isFinite(to) || from === 0) return null;
  return ((to - from) / Math.abs(from)) * 100;
}

function fmt(v: number, locale: Locale, digits = 2): string {
  return new Intl.NumberFormat(locale === "vi" ? "vi-VN" : "en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(v);
}

/** VND at the magnitude a reader actually speaks: "1,2 nghìn tỷ", "48 tỷ". */
function money(v: number, locale: Locale): string {
  const abs = Math.abs(v);
  const vi = locale === "vi";
  if (abs >= 1e12) return `${fmt(v / 1e12, locale, 1)} ${vi ? "nghìn tỷ đồng" : "trillion VND"}`;
  if (abs >= 1e9) return `${fmt(v / 1e9, locale, 1)} ${vi ? "tỷ đồng" : "billion VND"}`;
  if (abs >= 1e6) return `${fmt(v / 1e6, locale, 1)} ${vi ? "triệu đồng" : "million VND"}`;
  return `${fmt(v, locale, 0)} ${vi ? "đồng" : "VND"}`;
}

/**
 * Clamp to a whole word.
 *
 * Google shows about 155 characters and cuts mid-word without apology; cutting
 * on our own terms at least ends on something readable.
 */
export function clamp(text: string, max = 155): string {
  const one = text.replace(/\s+/g, " ").trim();
  if (one.length <= max) return one;
  const cut = one.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[,.;:—-]+$/, "")}…`;
}

/**
 * The FAQ that is safe to publish as structured data.
 *
 * Every answer here is a rule of the exchange or a statement about this page.
 * None of them change when the market moves, which is the test for whether a
 * fact belongs in a graph Google will cache and repeat.
 */
export function stableFaq(o: {
  symbol: string;
  locale: Locale;
  exchange: Exchange | null;
  /** The FRACTION `bandOf()` returns (0.07), not 7 — the repo's own unit. */
  band: number | null;
  vn30: boolean;
}): NarrativeFaq[] {
  const { symbol, locale, exchange, band, vn30 } = o;
  const out: NarrativeFaq[] = [];
  // 0.07 * 100 is 7.000000000000001 in binary floating point, and "±7.000000000000001%"
  // is how a unit conversion announces itself to every reader on the page.
  const bandPct = band === null ? null : Math.round(band * 1000) / 10;

  if (locale === "vi") {
    if (exchange) {
      out.push({
        q: `Cổ phiếu ${symbol} niêm yết ở sàn nào?`,
        a: `${symbol} được giao dịch trên sàn ${exchange}${vn30 ? ", và nằm trong rổ chỉ số VN30" : ""}.`,
      });
    }
    if (bandPct !== null) {
      out.push({
        q: `Biên độ dao động giá của ${symbol} trong một phiên là bao nhiêu?`,
        a: `Sàn ${exchange ?? "niêm yết"} áp dụng biên độ ±${bandPct}% mỗi phiên, nên giá ${symbol} chỉ được tăng tối đa ${bandPct}% (giá trần) hoặc giảm tối đa ${bandPct}% (giá sàn) so với giá tham chiếu.`,
      });
    }
    out.push({
      q: `Xem biểu đồ kỹ thuật của ${symbol} ở đâu?`,
      a: `Trang này hiển thị biểu đồ nến của ${symbol} với nhiều khung thời gian, hơn 15 chỉ báo kỹ thuật như RSI, MACD, Bollinger và công cụ vẽ. Dữ liệu tổng hợp từ nguồn công khai, chỉ mang tính tham khảo và không phải khuyến nghị đầu tư.`,
    });
    return out;
  }

  if (exchange) {
    out.push({
      q: `Which exchange is ${symbol} listed on?`,
      a: `${symbol} trades on ${exchange}${vn30 ? ", and is a member of the VN30 index" : ""}.`,
    });
  }
  if (bandPct !== null) {
    out.push({
      q: `What is the daily price band for ${symbol}?`,
      a: `${exchange ?? "The exchange"} applies a ±${bandPct}% band per session, so ${symbol} can rise at most ${bandPct}% (the ceiling) or fall at most ${bandPct}% (the floor) from its reference price.`,
    });
  }
  out.push({
    q: `Where can I see a technical chart for ${symbol}?`,
    a: `This page charts ${symbol} across multiple timeframes with over 15 technical indicators including RSI, MACD and Bollinger Bands, plus drawing tools. Data is compiled from public sources for reference only and is not investment advice.`,
  });
  return out;
}

/** schema.org FAQPage from a stable FAQ. */
export function faqPageLd(faq: NarrativeFaq[]): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faq.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };
}

/**
 * A meta description for a symbol, from the one board row the page already has.
 *
 * Kept separate from `symbolNarrative` because `generateMetadata` runs before
 * (and independently of) the render, and must not pay for a second bar fetch.
 *
 * It states no date, and that is deliberate. The board is a live snapshot with
 * no timestamp of its own, so the only date available here is the wall clock —
 * and stamping the clock onto a quote produces "22.05 as of 10/09" for a figure
 * that is in fact the 09/09 close whenever the session has not opened. The
 * prose on the page carries the exact session, because it is derived from bars
 * that know which day they are. A description that says "latest" is true all
 * day; one that names the wrong day is wrong in Google's index for weeks.
 */
export function quoteDescription(
  quote: Quote | undefined,
  o: { symbol: string; locale: Locale; exchange: Exchange | null },
): string | null {
  if (!quote || !Number.isFinite(quote.price) || quote.price <= 0) return null;
  const { symbol, locale, exchange } = o;
  const price = fmt(quote.price, locale);
  const sign = quote.changePct > 0 ? "+" : "";
  const move = Number.isFinite(quote.changePct) ? `${sign}${fmt(quote.changePct, locale)}%` : null;

  if (locale === "vi") {
    const head = `Giá cổ phiếu ${symbol}${exchange ? ` (${exchange})` : ""} mới nhất: ${price}${move ? `, ${move}` : ""}.`;
    return clamp(`${head} Xem biểu đồ nến, chỉ báo kỹ thuật, khối lượng và lịch sử giá ${symbol} theo phiên.`);
  }
  const head = `Latest ${symbol}${exchange ? ` (${exchange})` : ""} share price: ${price}${move ? `, ${move}` : ""}.`;
  return clamp(`${head} Candle chart, technical indicators, volume and session-by-session price history for ${symbol}.`);
}

/**
 * The page's prose. Each block is emitted only when its inputs exist.
 */
export function symbolNarrative(input: NarrativeInput): Narrative {
  const { symbol, locale, bars, exchange, band, vn30 } = input;
  const vi = locale === "vi";
  const faq = stableFaq({ symbol, locale, exchange, band, vn30 });
  const paragraphs: string[] = [];

  const usable = bars.filter((b) => Number.isFinite(b.c) && b.c > 0);
  if (usable.length < 2) {
    // No bars is not a reason to invent a sentence. The stable FAQ still
    // stands, because none of it depends on price.
    return { asOf: null, paragraphs, faq, description: "" };
  }

  const last = usable[usable.length - 1];
  const prev = usable[usable.length - 2];
  const asOf = dateOnly(last.t, locale);
  const changePct = pct(prev.c, last.c);
  const price = fmt(last.c, locale);

  const dir = changePct === null || Math.abs(changePct) < 0.005
    ? (vi ? "đi ngang" : "was unchanged")
    : changePct > 0
      ? (vi ? "tăng" : "rose")
      : (vi ? "giảm" : "fell");
  const movePart = changePct === null || Math.abs(changePct) < 0.005
    ? ""
    : ` ${fmt(Math.abs(changePct), locale)}%`;

  paragraphs.push(
    vi
      ? `Phiên gần nhất được ghi nhận trên trang này là ngày ${asOf}: ${symbol} đóng cửa ở ${price}, ${dir}${movePart} so với phiên liền trước.`
      : `The most recent session recorded on this page is ${asOf}: ${symbol} closed at ${price}, ${dir}${movePart} against the previous session.`,
  );

  // Where the last close sits inside the recent range.
  const window = usable.slice(-LOOKBACK);
  if (window.length >= 20) {
    const highs = window.map((b) => (Number.isFinite(b.h) && b.h > 0 ? b.h : b.c));
    const lows = window.map((b) => (Number.isFinite(b.l) && b.l > 0 ? b.l : b.c));
    const hi = Math.max(...highs);
    const lo = Math.min(...lows);
    if (hi > lo) {
      const position = ((last.c - lo) / (hi - lo)) * 100;
      const sessions = window.length;
      paragraphs.push(
        vi
          ? `Trong ${sessions} phiên gần nhất, ${symbol} dao động giữa ${fmt(lo, locale)} và ${fmt(hi, locale)}. Mức đóng cửa hiện tại nằm ở khoảng ${fmt(position, locale, 0)}% của biên độ đó, tính từ đáy lên đỉnh.`
          : `Across the last ${sessions} sessions ${symbol} has traded between ${fmt(lo, locale)} and ${fmt(hi, locale)}. The latest close sits about ${fmt(position, locale, 0)}% of the way up that range from its low.`,
      );
    }
  }

  // Volume against its own recent average, never against another symbol's.
  const volumes = usable.slice(-(VOLUME_WINDOW + 1), -1).map((b) => b.v).filter((v) => Number.isFinite(v) && v > 0);
  if (volumes.length >= 10 && Number.isFinite(last.v) && last.v > 0) {
    const mean = volumes.reduce((a, b) => a + b, 0) / volumes.length;
    const ratio = last.v / mean;
    if (Number.isFinite(ratio) && ratio > 0) {
      const shape = ratio >= 1.2
        ? (vi ? "cao hơn" : "above")
        : ratio <= 0.8
          ? (vi ? "thấp hơn" : "below")
          : (vi ? "xấp xỉ" : "close to");
      paragraphs.push(
        vi
          ? `Khối lượng khớp lệnh phiên ${asOf} đạt ${fmt(last.v, locale, 0)} cổ phiếu, ${shape} mức trung bình ${fmt(mean, locale, 0)} của ${volumes.length} phiên trước đó.`
          : `Volume on ${asOf} was ${fmt(last.v, locale, 0)} shares, ${shape} the ${fmt(mean, locale, 0)} average of the previous ${volumes.length} sessions.`,
      );
    }
  }

  // RSI, named as the indicator reading it is — not as a signal.
  if (typeof input.rsi14 === "number" && Number.isFinite(input.rsi14)) {
    const r = input.rsi14;
    const zone = r >= 70
      ? (vi ? "vùng quá mua theo cách đọc thông thường" : "what is conventionally read as overbought")
      : r <= 30
        ? (vi ? "vùng quá bán theo cách đọc thông thường" : "what is conventionally read as oversold")
        : (vi ? "vùng trung tính" : "neutral territory");
    paragraphs.push(
      vi
        ? `Chỉ báo RSI 14 phiên của ${symbol} ở mức ${fmt(r, locale, 1)}, tức ${zone}. Đây là một phép tính trên dữ liệu giá, không phải khuyến nghị mua bán.`
        : `The 14-period RSI for ${symbol} reads ${fmt(r, locale, 1)}, ${zone}. This is a calculation over past prices, not a recommendation.`,
    );
  }

  // Foreign flow, only when it was already loaded for this page.
  const foreign = (input.foreign ?? []).filter((d) => Number.isFinite(d.netVal));
  if (foreign.length >= 5) {
    const recent = foreign.slice(-5);
    const net = recent.reduce((a, d) => a + d.netVal, 0);
    const side = net > 0 ? (vi ? "mua ròng" : "net buyers of") : net < 0 ? (vi ? "bán ròng" : "net sellers of") : (vi ? "cân bằng" : "flat on");
    paragraphs.push(
      net === 0
        ? (vi
            ? `Trong 5 phiên gần nhất, giao dịch của khối ngoại với ${symbol} ở trạng thái cân bằng.`
            : `Over the last five sessions, foreign trading in ${symbol} was flat.`)
        : (vi
            ? `Trong 5 phiên gần nhất, khối ngoại ${side} ${symbol} với giá trị ${money(Math.abs(net), locale)}.`
            : `Over the last five sessions, foreign investors were ${side} ${symbol} worth ${money(Math.abs(net), locale)}.`),
    );
  }

  // The next ex-right date, if one is still ahead of the session this page
  // describes. Anchored to the last bar, not to the clock: the whole page is
  // "as of" that day, and a pure function cannot ask what time it is.
  const today = new Date(last.t * 1000).toISOString().slice(0, 10);
  const upcoming = (input.events ?? [])
    .filter((e) => typeof e.exDate === "string" && e.exDate >= today)
    .sort((a, b) => a.exDate.localeCompare(b.exDate))[0];
  if (upcoming) {
    const cash = upcoming.cash !== null && Number.isFinite(upcoming.cash) && upcoming.cash > 0
      ? (vi ? ` với mức ${fmt(upcoming.cash, locale, 0)} đồng/cổ phiếu` : ` at ${fmt(upcoming.cash, locale, 0)} VND per share`)
      : "";
    paragraphs.push(
      vi
        ? `Sự kiện quyền gần nhất sắp tới của ${symbol} có ngày giao dịch không hưởng quyền ${upcoming.exDate}${cash}.`
        : `The next corporate action for ${symbol} has an ex-rights date of ${upcoming.exDate}${cash}.`,
    );
  }

  const description = clamp(
    vi
      ? `Giá cổ phiếu ${symbol}${exchange ? ` (${exchange})` : ""}: ${price} tính đến ${asOf}. Biểu đồ nến, chỉ báo kỹ thuật, khối lượng và lịch sử giá ${symbol}.`
      : `${symbol}${exchange ? ` (${exchange})` : ""} share price: ${price} as of ${asOf}. Candle chart, technical indicators, volume and price history for ${symbol}.`,
  );

  return { asOf, paragraphs, faq, description };
}
