import { notFound } from "next/navigation";
import { AdminView } from "@/views/AdminView";
import { getSession } from "@/lib/auth/session";
import { isAdmin } from "@/lib/auth/admin";
import { dbAvailable, getDb } from "@/lib/db";
import { isLocale } from "@/lib/i18n";
import type { Locale } from "@/lib/types";

export const revalidate = 0;

/**
 * Owner-only reconciliation. A non-admin — signed out, or signed in without an
 * allowlisted email — gets a 404, not a 403: the page never admits it exists.
 */
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const session = await getSession();
  if (!isAdmin(session?.email)) notFound();

  const orders = dbAvailable() ? await (await getDb()).orders.recent(200) : [];
  return <AdminView locale={locale as Locale} orders={orders} />;
}
