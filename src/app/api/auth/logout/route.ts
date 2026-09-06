import { NextResponse } from "next/server";
import { SESSION_COOKIE, cookieOptions } from "@/lib/auth/session";

export const runtime = "nodejs";
export const revalidate = 0;

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { ...cookieOptions(), maxAge: 0 });
  return res;
}
