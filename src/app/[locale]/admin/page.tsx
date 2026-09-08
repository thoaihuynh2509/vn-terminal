import { notFound } from "next/navigation";
import { AdminView } from "@/views/AdminView";
import { getSession } from "@/lib/auth/session";
import { isAdmin } from "@/lib/auth/admin";
import { dbAvailable, getDb } from "@/lib/db";
import { isLocale } from "@/lib/i18n";
import type { Locale } from "@/lib/types";
import type { OrderRecord } from "@/lib/db";

/**
 * Owner-only reconciliation. A non-admin — signed out, or signed in without an
 * allowlisted email — gets a 404, not a 403: the page never admits it exists.
 */
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const session = await getSession();
  if (!isAdmin(session?.email)) notFound();

  // The retention thesis is either true or it is not, and it can only be checked
  // against a count of who actually holds a saved artifact — which nothing has
  // ever measured, because this page reported the orders ledger and nothing else.
  let orders: OrderRecord[] = [];
  let census: { userId: string; kind: string }[] = [];
  if (dbAvailable()) {
    try {
      const db = await getDb();
      [orders, census] = await Promise.all([db.orders.recent(200), db.docs.census()]);
    } catch {
      /* an unreachable database shows an empty dashboard, never an error page */
    }
  }
  return <AdminView locale={locale as Locale} orders={orders} census={census} />;
}
