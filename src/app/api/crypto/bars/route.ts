import { getCoinBars } from "@/lib/providers/crypto";
import { fail, ok } from "@/lib/api";

export const revalidate = 0;

export async function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  const id = p.get("id");
  if (!id) return fail(new Error("id is required"), 400);
  try {
    return ok(await getCoinBars(id, Math.min(Number(p.get("days")) || 90, 365)), 300);
  } catch (e) {
    return fail(e);
  }
}
