import { LoginView } from "@/views/LoginView";
import { guard } from "@/views/guard";

export const dynamic = "force-dynamic";

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  return <LoginView locale={guard(locale, "login", "dang-nhap")} next={sp.next} error={sp.error} />;
}
