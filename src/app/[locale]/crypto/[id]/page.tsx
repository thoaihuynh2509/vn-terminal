import { notFound } from "next/navigation";
import { CoinDetail } from "@/views/CoinDetail";
import { guard } from "@/views/guard";
import { cryptoEnabled } from "@/lib/flags";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return { title: id.charAt(0).toUpperCase() + id.slice(1) };
}

export default async function Page({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  if (!cryptoEnabled()) notFound();
  return <CoinDetail locale={guard(locale, "crypto", "crypto")} id={id} />;
}
