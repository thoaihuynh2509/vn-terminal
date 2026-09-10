/**
 * Magic-link delivery.
 *
 * The link is a bearer credential: the address it was requested for is the only
 * place it may appear. No driver ever returns it to the caller, and no route
 * puts it in a response body — that would hand every enumerator a session.
 */
import type { Locale } from "../types.ts";
import { getDict } from "../i18n/index.ts";
import { mailFrom } from "../brand.ts";

export type MailDriver = "console" | "resend" | "none";

/**
 * `console` prints a redeemable credential to stdout, so it is the default only
 * outside production — the same downgrade `activeAuthProvider()` applies to the
 * dev provider. In production an unset or unrecognised MAIL_PROVIDER answers
 * "none" and nothing is sent; naming `console` still opts in, which is how the
 * route suite reads back the link it just asked for.
 */
export function activeMailDriver(): MailDriver {
  const configured = process.env.MAIL_PROVIDER;
  if (configured === "resend") return "resend";
  if (configured === "console") return "console";
  return process.env.NODE_ENV === "production" ? "none" : "console";
}

/** False when no channel can carry a link; the request route answers 501. */
export function mailAvailable(): boolean {
  return activeMailDriver() !== "none";
}

export async function sendMagicLink({ to, url, locale }: { to: string; url: string; locale: Locale }): Promise<void> {
  const dict = getDict(locale);
  const driver = activeMailDriver();

  // Reached only if a caller skipped mailAvailable(): a log line here would be
  // a sign-in token sitting in the production log drain.
  if (driver === "none") throw new Error("no mail driver configured; MAIL_PROVIDER must name one in production");

  if (driver === "console") {
    console.log(`[magic-link] to=${to} ${url}`);
    return;
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("MAIL_PROVIDER=resend needs RESEND_API_KEY");

  // One plain fetch — the REST shape is three fields and stable; an SDK here
  // would be a dependency for nothing.
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: mailFrom(),
      to: [to],
      subject: dict.auth.mailSubject,
      text: `${dict.auth.mailBody}\n\n${url}\n`,
    }),
  });
  if (!res.ok) throw new Error(`resend responded ${res.status}`);
}

/**
 * Generic transactional email — retention mail (alerts, the daily brief).
 *
 * Unlike a magic link, this content is not a bearer credential, so an
 * unconfigured driver returns false and the caller (a cron) skips rather than
 * throwing: a missing mailer must never fail a whole batch. Returns whether the
 * message was handed to a channel.
 */
export async function sendEmail({ to, subject, text }: { to: string; subject: string; text: string }): Promise<boolean> {
  const driver = activeMailDriver();
  if (driver === "none") return false;
  if (driver === "console") {
    console.log(`[email] to=${to} subject=${subject}`);
    return true;
  }
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("MAIL_PROVIDER=resend needs RESEND_API_KEY");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: mailFrom(),
      to: [to],
      subject,
      text,
    }),
  });
  if (!res.ok) throw new Error(`resend responded ${res.status}`);
  return true;
}
