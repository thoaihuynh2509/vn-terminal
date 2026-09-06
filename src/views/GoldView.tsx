import { FeedBanner } from "@/components/FeedBanner";
import { GoldTable } from "@/components/GoldTable";
import { Delta } from "@/components/Delta";
import { KeyValue, Metric, Panel, PageShell, Stack } from "@/components/layout";
import { num, pct, usd, vnd } from "@/lib/format";
import { Explainer } from "@/components/Explainer";
import { PageHeader } from "@/components/editorial";
import { LiveStamp } from "@/components/LiveStamp";
import { getExplainer } from "@/content/explainers";
import { getDict } from "@/lib/i18n";
import { getGold, headlineRow, OZ_PER_LUONG, premium } from "@/lib/providers/gold";
import type { Locale } from "@/lib/types";

/**
 * Reference USD/VND rate. This is an input to the premium calculation, not a
 * quote — it is shown in the UI so the reader can see what the number rests on.
 * Override via env when a live FX feed is wired in.
 */
const USD_VND = Number(process.env.NEXT_PUBLIC_USD_VND ?? 26_300);

export async function GoldView({ locale }: { locale: Locale }) {
  const dict = getDict(locale);
  let gold = null;
  let error: string | undefined;
  try {
    gold = await getGold();
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  if (!gold) {
    return (
      <>
        <PageHeader title={dict.gold.title} subtitle={dict.gold.subtitle} />
        <FeedBanner dict={dict} detail={error} />
      </>
    );
  }

  const top = headlineRow(gold.rows);
  const prem = gold.world && top ? premium(gold.world.buy, top.sell, USD_VND) : null;

  const rail =
    prem && gold.world ? (
      <Panel title={dict.gold.premium}>
        <p className="text-[12px] text-ink-2">{dict.gold.premiumHint}</p>
        <div className="mt-3">
          <KeyValue
            rows={[
              { k: "XAU/USD", v: usd(gold.world.buy, locale) },
              { k: "USD/VND", v: num(USD_VND, locale, 0) },
              { k: locale === "vi" ? "Ounce / lượng" : "Troy oz per tael", v: num(OZ_PER_LUONG, locale, 5) },
              { k: dict.gold.world, v: vnd(prem.worldVndPerLuong, locale) },
            ]}
          />
        </div>
      </Panel>
    ) : undefined;

  return (
    <>
      <PageHeader title={dict.gold.title} subtitle={dict.gold.subtitle} meta={dict.gold.perLuongNote} />

      <div className="mb-3"><LiveStamp locale={locale} /></div>

      <PageShell rail={rail}>
        <Stack>
          {/* Two figures, not four: the headline ask and the premium are the two
              numbers the table below cannot give at a glance. Bid and world spot
              are already in the table and the rail. */}
          <div className="grid gap-2 sm:grid-cols-2">
            {top && (
              <Metric
                label={`${top.name} · ${dict.gold.sell}`}
                value={vnd(top.sell, locale)}
                delta={<Delta change={top.changeSell || top.changeBuy} locale={locale} digits={0} />}
              />
            )}
            {prem && (
              /* No Delta here: the premium is a standing level, not a move. A green
                 ▲ would claim gold "rose 53%" when it means domestic sits 53% above
                 world parity — a status hue must never stand in for a positive sign. */
              <Metric
                label={dict.gold.premium}
                value={vnd(prem.diff, locale)}
                delta={<span className="tnum text-ink-2">{pct(prem.pct, locale)} {dict.gold.vsWorld}</span>}
              />
            )}
          </div>

          <div>
            <h2 className="mb-3 text-[15px] font-semibold tracking-tight">{dict.gold.domestic}</h2>
            <GoldTable gold={gold} locale={locale} dict={dict} />
          </div>
        </Stack>
      </PageShell>

      <Explainer content={getExplainer("gold", locale)} />
    </>
  );
}
