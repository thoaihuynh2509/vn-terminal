import { getGold } from "@/lib/providers/gold";
import { fail, ok } from "@/lib/api";

export const revalidate = 0;

export async function GET() {
  try {
    return ok(await getGold(), 120);
  } catch (e) {
    return fail(e);
  }
}
