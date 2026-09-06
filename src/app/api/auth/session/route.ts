import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { activeAuthProvider } from "@/lib/auth/provider";
import { capabilitiesFor } from "@/lib/auth/entitlement";

export const runtime = "nodejs";
export const revalidate = 0;

export async function GET() {
  const s = await getSession();
  return NextResponse.json({
    ok: true,
    data: s
      ? { email: s.email, tier: s.tier, capabilities: capabilitiesFor(s.tier) }
      : { email: null, tier: "anon" as const, capabilities: capabilitiesFor("anon") },
    provider: activeAuthProvider(),
  });
}
