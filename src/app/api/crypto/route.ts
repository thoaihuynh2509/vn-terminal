import { getCoins } from "@/lib/providers/crypto";
import { fail, ok } from "@/lib/api";

export const revalidate = 0;

export async function GET(req: Request) {
  try {
    const limit = Math.min(Number(new URL(req.url).searchParams.get("limit")) || 50, 250);
    return ok(await getCoins(limit), 90);
  } catch (e) {
    return fail(e);
  }
}
