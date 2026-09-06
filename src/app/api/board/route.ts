import { getBoard, VN30 } from "@/lib/providers/vnstock";
import { fail, ok } from "@/lib/api";

export const revalidate = 0;

export async function GET(req: Request) {
  try {
    const q = new URL(req.url).searchParams.get("symbols");
    const symbols = q
      ? q.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean).slice(0, 40)
      : VN30;
    return ok(await getBoard(symbols), 60);
  } catch (e) {
    return fail(e);
  }
}
