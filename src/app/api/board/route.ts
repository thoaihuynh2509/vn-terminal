import { getBoard, VN30 } from "@/lib/providers/vnstock";
import { clientIp, createLimiter } from "@/lib/rate-limit";
import { fail, ok } from "@/lib/api";

export const revalidate = 0;

/**
 * The whole VN30 board, uncapped, was one unauthenticated GET away — cheap for a
 * competitor to mirror and our bill to pay, since each miss fans out to the
 * upstream feed. Generous enough that no reader will ever see it; low enough
 * that scraping the board every second is not free. Per-process, so it bounds
 * one instance rather than enforcing a global quota (see `rate-limit.ts`).
 */
const limited = createLimiter({ windowMs: 60_000, max: 60 });

export async function GET(req: Request) {
  if (limited(clientIp(req))) return fail(new Error("rate limited"), 429);
  try {
    const q = new URL(req.url).searchParams.get("symbols");
    const symbols = q
      ? q.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean).slice(0, 40)
      : VN30;
    // `spark` has always been in this response; keep it, so a public caller
    // does not lose a field to an internal change of feed.
    return ok(await getBoard(symbols, { spark: true }), 60);
  } catch (e) {
    return fail(e);
  }
}
