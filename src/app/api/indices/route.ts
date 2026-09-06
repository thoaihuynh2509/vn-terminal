import { getIndices } from "@/lib/providers/vnstock";
import { fail, ok } from "@/lib/api";

export const revalidate = 0;

export async function GET() {
  try {
    return ok(await getIndices(), 45);
  } catch (e) {
    return fail(e);
  }
}
