import { redirect } from "next/navigation";
import { guard } from "@/views/guard";
import { href } from "@/lib/i18n";
import { DEFAULT_SYMBOL } from "@/lib/providers/vnstock";

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const loc = guard(locale, "terminal", "chart");
  // Default symbol so the workspace is never empty.
  redirect(href(loc, "terminal", `/${DEFAULT_SYMBOL}`));
}
