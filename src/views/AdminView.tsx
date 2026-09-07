import { PageHeader } from "@/components/editorial";
import { StatTile } from "@/components/ui";
import { EmptyState } from "@/components/layout";
import { ConfirmPaidButton } from "@/components/ConfirmPaidButton";
import { vnd } from "@/lib/format";
import { getDict } from "@/lib/i18n";
import { INVESTED_KINDS, investedStats } from "@/lib/retention/invested";
import type { OrderRecord } from "@/lib/db";
import type { Locale } from "@/lib/types";

/**
 * Owner-only reconciliation over the orders ledger. Rendered only after the
 * page has checked `isAdmin`; it takes already-fetched rows and shows revenue,
 * paid/pending counts and the recent orders — read-only, no controls.
 */
export function AdminView({ locale, orders, census = [] }: {
  locale: Locale;
  orders: OrderRecord[];
  /** Owner-and-kind for every saved artifact; no content is read. */
  census?: { userId: string; kind: string }[];
}) {
  const dict = getDict(locale);
  const paid = orders.filter((o) => o.status === "paid");
  const revenue = paid.reduce((sum, o) => sum + o.amount, 0);
  const pending = orders.filter((o) => o.status === "pending").length;
  const invested = investedStats(census);

  const status = (s: OrderRecord["status"]) =>
    s === "paid" ? dict.admin.sPaid : s === "pending" ? dict.admin.sPending : dict.admin.sFailed;
  const statusClass = (s: OrderRecord["status"]) =>
    s === "paid" ? "text-up" : s === "failed" ? "text-down" : "text-muted";
  const fmtDate = (d: Date) =>
    new Intl.DateTimeFormat(locale === "vi" ? "vi-VN" : "en-US", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);

  return (
    <>
      <PageHeader title={dict.admin.title} subtitle={dict.admin.subtitle} />

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <StatTile label={dict.admin.revenue} value={<span className="tnum">{vnd(revenue, locale)}</span>} />
        <StatTile label={dict.admin.paidCount} value={<span className="tnum">{paid.length}</span>} />
        <StatTile label={dict.admin.pendingCount} value={<span className="tnum">{pending}</span>} />
        {/* The number the roadmap is bet on: readers who have saved something. */}
        <StatTile label={dict.admin.invested} value={<span className="tnum">{invested.invested}</span>} />
        <StatTile label={dict.admin.artifacts} value={<span className="tnum">{invested.total}</span>} />
        <StatTile
          label={dict.admin.byKind}
          value={
            <span className="tnum text-[13px]">
              {INVESTED_KINDS.map((k) => `${k} ${invested.byKind[k] ?? 0}`).join(" · ")}
            </span>
          }
        />
      </div>

      {orders.length === 0 ? (
        <EmptyState title={dict.admin.empty} />
      ) : (
        <div className="card relative overflow-x-auto">
          <table className="data-table w-full text-[13px]">
            <caption className="sr-only">{dict.admin.title}</caption>
            <thead className="border-b border-line bg-surface-2 text-[11px] uppercase tracking-wide text-muted">
              <tr>
                <th scope="col" className="px-3 py-2 text-left font-medium">{dict.admin.colDate}</th>
                <th scope="col" className="px-3 py-2 text-left font-medium">{dict.admin.colEmail}</th>
                <th scope="col" className="px-3 py-2 text-left font-medium">{dict.admin.colTier}</th>
                <th scope="col" className="px-3 py-2 text-left font-medium">{dict.admin.colPlan}</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">{dict.admin.colAmount}</th>
                <th scope="col" className="px-3 py-2 text-left font-medium">{dict.admin.colStatus}</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} className="border-b border-line last:border-0">
                  <td className="tnum px-3 py-2 text-muted">{fmtDate(o.createdAt)}</td>
                  <td className="px-3 py-2">{o.email}</td>
                  <td className="px-3 py-2 uppercase">{o.tier}</td>
                  <td className="px-3 py-2">{o.plan === "annual" ? dict.admin.pAnnual : dict.admin.pMonthly}</td>
                  <td className="tnum px-3 py-2 text-right">{vnd(o.amount, locale)}</td>
                  <td className={`px-3 py-2 font-medium ${statusClass(o.status)}`}>
                    <span className="inline-flex items-center gap-2">
                      {status(o.status)}
                      {o.status === "pending" && (
                        <ConfirmPaidButton
                          orderId={o.id}
                          label={dict.admin.confirmPaid}
                          busyLabel={dict.admin.confirming}
                          failLabel={dict.admin.confirmFailed}
                        />
                      )}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
