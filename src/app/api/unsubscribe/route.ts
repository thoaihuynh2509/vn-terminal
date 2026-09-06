import { NextResponse } from "next/server";
import { dbAvailable, getDb, DbUnavailableError } from "@/lib/db";
import { verifyUnsub } from "@/lib/retention/unsubscribe";

export const runtime = "nodejs";
export const revalidate = 0;

/**
 * One-click unsubscribe from a teaser email — no login required.
 *
 * Authorised by the HMAC token in the link, not a session, because the reader
 * is not signed in. It only ever SETS the opt-out for the address the token was
 * minted for, so the action is safe as a GET (email clients follow links) and
 * idempotent. It never reveals whether the address has an account.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const email = (url.searchParams.get("email") ?? "").toLowerCase();
  const token = url.searchParams.get("token");
  const vi = url.searchParams.get("l") !== "en";

  const done = (msg: string) =>
    new NextResponse(
      `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
        `<title>${vi ? "Huỷ nhận email" : "Unsubscribe"}</title>` +
        `<body style="font:16px system-ui;margin:0;display:grid;place-items:center;min-height:100vh;background:#0d0d0d;color:#eee">` +
        `<p style="max-width:32ch;text-align:center;padding:24px">${msg}</p></body>`,
      { headers: { "content-type": "text/html; charset=utf-8" } },
    );

  // A bad or unverifiable link still shows a neutral page — never an error that
  // tells a probing reader which addresses exist.
  if (!email || !verifyUnsub(email, token) || !dbAvailable()) {
    return done(vi ? "Liên kết không hợp lệ hoặc đã hết hạn." : "This link is invalid or has expired.");
  }

  try {
    const db = await getDb();
    await db.users.setMarketingOptOut(email, true);
  } catch (err) {
    if (!(err instanceof DbUnavailableError)) throw err;
  }
  return done(vi ? "Đã huỷ nhận email. Bạn sẽ không nhận bản tin quảng bá nữa." : "You have been unsubscribed from marketing emails.");
}
