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
import { shouldFire, type PriceAlert } from "../alerts/alerts.ts";
import { num } from "../format.ts";
import type { Locale } from "../types.ts";
import type { Brief } from "../brief.ts";

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
): UserAlertRun {
  const fired: PriceAlert[] = [];
  const next = alerts.map((a) => {
    if (a.triggeredAt) return a;
    const q = quotes.get(a.symbol.toUpperCase());
    if (!q) return a;
    if (!shouldFire(a, q.price, q.prevClose)) return a;
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
  const lines = fired.map((a) => {
    const q = quotes.get(a.symbol.toUpperCase());
    const now = q ? num(q.price, locale) : "—";
    const cond = COND[a.condition][locale];
    return vi
      ? `• ${a.symbol}: giá ${cond} ${num(a.price, locale)} (hiện ${now})`
      : `• ${a.symbol}: price ${cond} ${num(a.price, locale)} (now ${now})`;
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
    ? "Mở VN Terminal để xem chi tiết. Cảnh báo chỉ kích hoạt một lần; đặt lại trong ứng dụng."
    : "Open VN Terminal for details. Each alert fires once; re-arm it in the app.";
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
    ? `Gói ${name} của bạn hết hạn ngày ${date}.\n\nGia hạn trong VN Terminal để không mất cảnh báo giá, trợ lý AI và các công cụ biểu đồ.\n`
    : `Your ${name} plan ends on ${date}.\n\nRenew in VN Terminal to keep your price alerts, the AI assistant and the charting tools.\n`;
  return { subject, text };
}

/** The weekly teaser to a signed-up free reader. Pure. `unsubUrl` is required. */
export function teaserEmail(
  locale: Locale,
  links: { pricingUrl: string; unsubUrl: string },
): { subject: string; text: string } {
  const vi = locale === "vi";
  const subject = vi
    ? "Mở khoá biểu đồ nâng cao, cảnh báo giá và trợ lý AI"
    : "Unlock advanced charts, price alerts and the AI assistant";
  const body = vi
    ? `Bạn đang dùng bản miễn phí của VN Terminal. Gói trả phí thêm: chỉ báo đầy đủ, cảnh báo giá gửi tận email, so sánh hai mã và trợ lý AI.\n\nXem gói: ${links.pricingUrl}`
    : `You're on the free plan of VN Terminal. A paid plan adds the full indicator library, price alerts delivered by email, two-symbol compare and the AI assistant.\n\nSee plans: ${links.pricingUrl}`;
  const foot = vi ? `\n\nHuỷ nhận email: ${links.unsubUrl}\n` : `\n\nUnsubscribe: ${links.unsubUrl}\n`;
  return { subject, text: `${body}${foot}` };
}
