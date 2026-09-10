/**
 * The product's name, in the one place that owns it.
 *
 * The name appears in the header, every page title, four kinds of email, the
 * payment memo a buyer reads in their MoMo app, the AI assistant's system
 * prompt and two OG images. Before this file it was seventeen string literals,
 * so renaming meant a grep and a hope. It is now one edit here.
 *
 * `defaultOrigin` lives beside the name deliberately: a rename and a domain
 * move are the same decision, taken on the same day, and splitting them across
 * two files is how one of them gets forgotten.
 */
import type { Locale } from "./types.ts";

export const BRAND = {
  /** Display name, identical in both locales — it is a proper noun. */
  name: "Cổ Phiếu Việt",
  /** ASCII form, for a sender local-part or a file name. */
  slug: "cophieuviet",
  tagline: {
    vi: "Chứng khoán · Vàng",
    en: "Stocks · Gold",
  },
  /**
   * Fallback origin when NEXT_PUBLIC_SITE_URL is unset.
   *
   * Deliberately still the vercel.app host: it is the origin that actually
   * serves. Pointing this at a domain before that domain resolves would put a
   * dead host in every magic link and payment callback — the two URLs that
   * cannot be retried.
   */
  defaultOrigin: "https://vn-terminal.vercel.app",
} as const;

export function brandName(): string {
  return BRAND.name;
}

export function brandTagline(locale: Locale): string {
  return BRAND.tagline[locale];
}

/**
 * Sender identity for transactional mail.
 *
 * MAIL_FROM wins when set, because a verified domain sender is the only thing
 * that keeps this out of a spam folder. The fallback is Resend's shared
 * onboarding address, which works without a verified domain.
 */
export function mailFrom(): string {
  const configured = (process.env.MAIL_FROM || "").trim();
  return configured || `${BRAND.name} <onboarding@resend.dev>`;
}
