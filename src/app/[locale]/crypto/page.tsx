import { CryptoView } from "@/views/CryptoView";
import { guard } from "@/views/guard";

export const revalidate = 90;

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  return <CryptoView locale={guard(locale, "crypto", "crypto")} page={page} />;
}
