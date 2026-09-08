import { PricingView } from "@/views/PricingView";
import { guard } from "@/views/guard";
import { sectionMetadata } from "@/views/meta";
import { getDict } from "@/lib/i18n";
import { isPaidTier } from "@/lib/billing/plans";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const locale = guard((await params).locale, "pricing", "goi-dich-vu");
  const d = getDict(locale).pricing;
  return sectionMetadata(locale, "pricing", { title: d.title, description: d.subtitle });
}

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ plan?: string }>;
}) {
  const { locale } = await params;
  // Every in-app ceiling links here with ?plan=plus|pro. Reading it is what
  // turns a generic price list back into an answer to what the reader just hit.
  const sp = await searchParams;
  const highlight = isPaidTier(sp.plan) ? sp.plan : null;
  return <PricingView locale={guard(locale, "pricing", "goi-dich-vu")} highlight={highlight} />;
}
