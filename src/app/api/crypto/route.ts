import { getCoins } from "@/lib/providers/crypto";
import { cryptoEnabled } from "@/lib/flags";
import { fail, ok } from "@/lib/api";

export const revalidate = 0;

export async function GET(req: Request) {
  // The flag hid the crypto nav and pages but left this route open, so the
  // feature was "off" everywhere except the one place that costs us CoinGecko
  // quota. A disabled feature answers 404, exactly as if it did not exist.
  if (!cryptoEnabled()) return fail(new Error("not_found"), 404);
  try {
    const limit = Math.min(Number(new URL(req.url).searchParams.get("limit")) || 50, 250);
    return ok(await getCoins(limit), 90);
  } catch (e) {
    return fail(e);
  }
}
