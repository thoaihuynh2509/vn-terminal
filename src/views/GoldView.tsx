import { FeedBanner } from "@/components/FeedBanner";
import { GoldTable } from "@/components/GoldTable";
import { Delta } from "@/components/Delta";
import { KeyValue, Panel, PageShell, Stack } from "@/components/layout";
import { StatTile, DarkPanel } from "@/components/ui";
import { num, pct, usd, vnd } from "@/lib/format";
import { Explainer } from "@/components/Explainer";
import { PageHeader } from "@/components/editorial";
import { LiveStamp } from "@/components/LiveStamp";
import { getExplainer } from "@/content/explainers";
import { getDict, PATHS } from "@/lib/i18n";
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
        <p className="text-[13px] leading-relaxed text-ink-2">{dict.gold.premiumHint}</p>
        <div className="mt-4">
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
      <PageHeader
        title={dict.gold.title}
        subtitle={dict.gold.subtitle}
        meta={dict.gold.perLuongNote}
        action={<LiveStamp locale={locale} />}
      />

      <PageShell rail={rail}>
        <Stack gap="md">
          {/* Three figures: the headline ask, the standing premium, and world
              spot. Bid sits in the table; repeating it here would waste the row. */}
          <div className="grid gap-4 sm:grid-cols-3">
            {top && (
              <StatTile
                label={`${top.name} · ${dict.gold.sell}`}
                value={vnd(top.sell, locale)}
                sub={<Delta change={top.changeSell || top.changeBuy} locale={locale} digits={0} />}
              />
            )}
            {prem && (
              /* No Delta here: the premium is a standing level, not a move. A green
                 ▲ would claim gold "rose 53%" when it means domestic sits 53% above
                 world parity — a status hue must never stand in for a positive sign. */
              <StatTile
                label={dict.gold.premium}
                value={vnd(prem.diff, locale)}
                sub={<span className="tnum font-mono text-ink-2">{pct(prem.pct, locale)} {dict.gold.vsWorld}</span>}
              />
            )}
            {gold.world && (
              <StatTile
                label="XAU/USD"
                value={usd(gold.world.buy, locale)}
                sub={<Delta change={gold.world.changeBuy} locale={locale} digits={2} />}
              />
            )}
          </div>

          <div>
            <h2 className="mb-4 text-[18px] font-semibold tracking-tight">{dict.gold.domestic}</h2>
            <GoldTable gold={gold} locale={locale} dict={dict} />
          </div>

          <DarkPanel
            eyebrow={dict.pricing.plus}
            title={dict.pricing.fAlertEmail}
            body={dict.chart.alertScopeEmail}
            cta={dict.pricing.cta}
            href={`/${locale}/${PATHS.pricing[locale]}`}
          />
        </Stack>
      </PageShell>

      <Explainer content={getExplainer("gold", locale)} />
    </>
  );
}
