import { VerifyView } from "@/views/VerifyView";
import { guard } from "@/views/guard";

export const dynamic = "force-dynamic";

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  return <VerifyView locale={guard(locale, "login", "login")} token={sp.token} />;
}
