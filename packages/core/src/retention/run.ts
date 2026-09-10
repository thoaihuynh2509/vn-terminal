/**
 * Server-side retention jobs, kept PURE so the trigger and the wording are unit
 * tested without a network, a database or a clock. The cron routes are thin
 * shells that fetch, call these, then persist and email.
 *
 * This is the server evaluator `alerts.ts` was written to make possible: the
 * same `shouldFire` logic that runs in an open tab, now run against the latest
 * board so an alert reaches a subscriber who has the page closed — the single
 * biggest reason to come back, and the clearest thing a paid tier sells.
 */
import { BRAND } from "../brand.ts";
import {
  alertKind, indicatorKey, observationFor, shouldFire,
  type AlertObservation, type PriceAlert,
} from "../alerts/alerts.ts";
import { num } from "../format.ts";
import { siteUrl } from "../site.ts";
import type { Locale } from "../types.ts";
import type { Brief } from "../brief.ts";
import type { NearLevel } from "./levels.ts";

export interface QuoteLite {
  symbol: string;
  price: number;
  prevClose?: number;
}

/** Distinct, upper-cased symbols an alert set references — what to fetch. */
export function alertSymbols(alerts: PriceAlert[]): string[] {
  return [...new Set(alerts.filter((a) => !a.triggeredAt).map((a) => a.symbol.toUpperCase()))];
}

export interface UserAlertRun {
  next: PriceAlert[];
  fired: PriceAlert[];
}

/**
 * Evaluate one reader's alerts against a price snapshot. `prevClose` is the
 * "previous observation" a cross needs — one cron tick has a single price, and
 * the close is the honest prior point to cross from. An alert whose symbol has
 * no quote this run is left untouched, not dropped.
 */
export function runUserAlerts(
  alerts: PriceAlert[],
  quotes: Map<string, QuoteLite>,
  now: number,
  /** Indicator readings by `${SYMBOL}:${indicatorKey}`, when the caller has bars. */
  indicators?: Map<string, AlertObservation>,
): UserAlertRun {
  const fired: PriceAlert[] = [];
  const next = alerts.map((a) => {
    if (a.triggeredAt) return a;
    const sym = a.symbol.toUpperCase();
    const q = quotes.get(sym);
    if (!q) return a;
    // An indicator alert is tested against its indicator, never against the
    // price — otherwise "RSI above 70" fires as soon as the share costs 70.
    const key = indicatorKey(a);
    const reading = indicators?.get(`${sym}:${key}`);
    const obs = observationFor(
      a,
      { current: q.price, previous: q.prevClose },
      reading ? { [key]: reading } : undefined,
    );
    if (!obs || !Number.isFinite(obs.current)) return a;
    if (!shouldFire(a, obs.current, obs.previous)) return a;
    const t = { ...a, triggeredAt: now };
    fired.push(t);
    return t;
  });
  return { next, fired };
}

const COND: Record<PriceAlert["condition"], { vi: string; en: string }> = {
  above: { vi: "vượt lên", en: "rose above" },
  below: { vi: "rơi xuống", en: "fell below" },
  cross_up: { vi: "cắt lên", en: "crossed up through" },
  cross_down: { vi: "cắt xuống", en: "crossed down through" },
};

/** Subject + body for a batch of a reader's fired alerts. Pure. */
export function alertEmail(
  fired: PriceAlert[],
  quotes: Map<string, QuoteLite>,
  locale: Locale = "vi",
): { subject: string; text: string } {
  const vi = locale === "vi";
  const seg = vi ? "bieu-do" : "chart";
  // Every line links straight back to the chart it is about, tagged so the
  // funnel can tell an alert-driven return from organic navigation — the whole
  // point of sending the mail is the trip back.
  const link = (symbol: string) =>
    `${siteUrl()}/${locale}/${seg}/${symbol.toUpperCase()}?rail=alerts&src=alert_email`;
  const lines = fired.map((a) => {
    const q = quotes.get(a.symbol.toUpperCase());
    const now = q ? num(q.price, locale) : "—";
    const cond = COND[a.condition][locale];
    // An indicator alert says what it watched; a bare number would read as a
    // price the reader never set.
    const what = alertKind(a) === "indicator"
      ? `${(a.indicator ?? "rsi").toUpperCase()} ${num(a.price, locale, 0)}`
      : num(a.price, locale);
    const head = vi
      ? `• ${a.symbol}: ${alertKind(a) === "indicator" ? "" : "giá "}${cond} ${what} (hiện ${now})`
      : `• ${a.symbol}: ${alertKind(a) === "indicator" ? "" : "price "}${cond} ${what} (now ${now})`;
    return `${head}\n  ${link(a.symbol)}`;
  });
  const one = fired.length === 1 ? fired[0] : null;
  const subject = one
    ? vi
      ? `🔔 ${one.symbol} ${COND[one.condition].vi} ${num(one.price, locale)}`
      : `🔔 ${one.symbol} ${COND[one.condition].en} ${num(one.price, locale)}`
    : vi
      ? `🔔 ${fired.length} cảnh báo giá vừa kích hoạt`
      : `🔔 ${fired.length} price alerts triggered`;
  const head = vi ? "Cảnh báo giá của bạn vừa kích hoạt:" : "Your price alerts just triggered:";
  const foot = vi
    ? `Mở ${BRAND.name} để xem chi tiết. Cảnh báo chỉ kích hoạt một lần; đặt lại trong ứng dụng.`
    : `Open ${BRAND.name} for details. Each alert fires once; re-arm it in the app.`;
  return { subject, text: `${head}\n\n${lines.join("\n")}\n\n${foot}\n` };
}

/** Plain-text daily brief email. Pure so the wording is testable. */
export function briefEmail(brief: Brief, locale: Locale = "vi"): { subject: string; text: string } {
  const body = brief.paragraphs
    .map((p) => `${p.heading}\n${p.sentences.join(" ")}`)
    .join("\n\n");
  const foot =
    locale === "vi"
      ? "Tổng hợp từ nguồn công khai, có thể trễ, không phải khuyến nghị đầu tư."
      : "Aggregated from public sources, may lag, not investment advice.";
  return { subject: brief.headline, text: `${brief.standfirst}\n\n${body}\n\n— ${foot}\n` };
}

/**
 * Is a subscriber due a renewal reminder? True only inside the final `days`
 * before expiry AND not already reminded for this term. `grant` clears the
 * reminded mark, so a renewal re-arms the reminder for the new term — that is
 * what keeps this from mailing every day through the whole window.
 */
export function renewalDue(
  expiresAt: Date | null,
  remindedAt: Date | null,
  now: Date,
  days = 7,
): boolean {
  if (!expiresAt || remindedAt) return false;
  const ms = expiresAt.getTime() - now.getTime();
  return ms > 0 && ms <= days * 86_400_000;
}

/** The renewal-reminder email. Pure. */
export function renewalEmail(
  tier: "plus" | "pro",
  expiresAt: Date,
  locale: Locale = "vi",
): { subject: string; text: string } {
  const vi = locale === "vi";
  const name = tier === "pro" ? "Pro" : "Plus";
  const date = new Intl.DateTimeFormat(vi ? "vi-VN" : "en-US", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(expiresAt);
  const subject = vi ? `Gói ${name} của bạn sắp hết hạn` : `Your ${name} plan is ending soon`;
  const text = vi
    ? `Gói ${name} của bạn hết hạn ngày ${date}.\n\nGia hạn trong ${BRAND.name} để không mất cảnh báo giá, trợ lý AI và các công cụ biểu đồ.\n`
    : `Your ${name} plan ends on ${date}.\n\nRenew in ${BRAND.name} to keep your price alerts, the AI assistant and the charting tools.\n`;
  return { subject, text };
}

/** The weekly teaser to a signed-up free reader. Pure. `unsubUrl` is required. */
export interface WeekOnChart {
  /** In-app alerts that fired for this reader in the last week. */
  alertsFired: number;
  /** Watchlist names that closed at their ceiling or floor. */
  limitCloses: { symbol: string; dir: "ceiling" | "floor" }[];
  /** Drawn levels price walked up to. */
  levelsHit: number;
}

export function teaserEmail(
  locale: Locale,
  links: { pricingUrl: string; unsubUrl: string; chartUrl?: string },
  week?: WeekOnChart,
): { subject: string; text: string } {
  const vi = locale === "vi";

  /**
   * The personal half, when there is one.
   *
   * A weekly mail that only says "here is what you could buy" is an
   * advertisement, and free readers learn to ignore it. A mail that first tells
   * them what happened on THEIR chart is worth opening, and the offer lands on a
   * reader who has just been reminded the thing is useful.
   */
  const lines: string[] = [];
  if (week) {
    if (week.alertsFired > 0) {
      lines.push(vi
        ? `• ${week.alertsFired} cảnh báo của bạn đã kích hoạt tuần này.`
        : `• ${week.alertsFired} of your alerts triggered this week.`);
    }
    for (const c of week.limitCloses.slice(0, 3)) {
      const label = c.dir === "ceiling" ? (vi ? "giá trần" : "its ceiling") : (vi ? "giá sàn" : "its floor");
      lines.push(vi ? `• ${c.symbol} đóng cửa ở ${label}.` : `• ${c.symbol} closed at ${label}.`);
    }
    if (week.levelsHit > 0) {
      lines.push(vi
        ? `• Giá đã chạm ${week.levelsHit} mức bạn đã vẽ.`
        : `• Price reached ${week.levelsHit} level(s) you drew.`);
    }
  }
  const personal = lines.length
    ? `${vi ? "Tuần của bạn trên biểu đồ:" : "Your week on the chart:"}\n${lines.join("\n")}\n\n`
    : "";

  // The subject follows the content: a personal mail should not be dressed as
  // an advert, and an advert should not pretend to be personal.
  const subject = lines.length
    ? (vi ? "Tuần của bạn trên biểu đồ" : "Your week on the chart")
    : (vi
      ? "Mở khoá biểu đồ nâng cao, cảnh báo giá và trợ lý AI"
      : "Unlock advanced charts, price alerts and the AI assistant");

  const body = vi
    ? `Bạn đang dùng bản miễn phí của ${BRAND.name}. Gói trả phí thêm: chỉ báo đầy đủ, cảnh báo giá gửi tận email, so sánh hai mã và trợ lý AI.\n\nXem gói: ${links.pricingUrl}`
    : `You're on the free plan of ${BRAND.name}. A paid plan adds the full indicator library, price alerts delivered by email, two-symbol compare and the AI assistant.\n\nSee plans: ${links.pricingUrl}`;
  const open = links.chartUrl
    ? (vi ? `\n\nMở biểu đồ: ${links.chartUrl}` : `\n\nOpen your chart: ${links.chartUrl}`)
    : "";
  const foot = vi ? `\n\nHuỷ nhận email: ${links.unsubUrl}\n` : `\n\nUnsubscribe: ${links.unsubUrl}\n`;
  return { subject, text: `${personal}${body}${open}${foot}` };
}

/**
 * The personal half of the daily brief.
 *
 * The market summary is the same for everyone; this is the part that is only
 * true for one reader — their watchlist moved, their alert fired, price walked
 * up to a line they drew. It is what turns a newsletter into a reason to open
 * the chart, and every line carries the link that gets them there.
 *
 * Returns null when there is nothing personal to say. An empty "since yesterday"
 * heading is worse than none: it teaches the reader the section is noise.
 */
export function personalNote(
  locale: Locale,
  data: {
    movers: { symbol: string; changePct: number }[];
    fired: PriceAlert[];
    levels: NearLevel[];
  },
  limit = 4,
): string | null {
  const vi = locale === "vi";
  const seg = vi ? "bieu-do" : "chart";
  const link = (symbol: string) =>
    `${siteUrl()}/${locale}/${seg}/${symbol.toUpperCase()}?src=brief`;

  const lines: string[] = [];

  for (const a of data.fired.slice(0, limit)) {
    lines.push(vi
      ? `• ${a.symbol}: cảnh báo đã kích hoạt tại ${num(a.price, locale)}\n  ${link(a.symbol)}`
      : `• ${a.symbol}: alert triggered at ${num(a.price, locale)}\n  ${link(a.symbol)}`);
  }

  for (const l of data.levels.slice(0, limit)) {
    const away = num(Math.abs(l.distancePct), locale, 2);
    lines.push(vi
      ? `• ${l.symbol}: giá đang cách mức bạn vẽ (${num(l.price, locale)}) ${away}%\n  ${link(l.symbol)}`
      : `• ${l.symbol}: price is ${away}% from your level at ${num(l.price, locale)}\n  ${link(l.symbol)}`);
  }

  // Movers last: the least personal of the three, and the first to cut.
  for (const m of data.movers.slice(0, limit)) {
    const sign = m.changePct >= 0 ? "+" : "";
    lines.push(vi
      ? `• ${m.symbol}: ${sign}${num(m.changePct, locale, 2)}%\n  ${link(m.symbol)}`
      : `• ${m.symbol}: ${sign}${num(m.changePct, locale, 2)}%\n  ${link(m.symbol)}`);
  }

  if (lines.length === 0) return null;
  const head = vi ? "TỪ HÔM QUA — theo dõi của bạn" : "SINCE YESTERDAY — your watchlist";
  return `${head}\n${lines.join("\n")}`;
}
