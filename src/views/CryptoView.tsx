import { CryptoTable } from "@/components/CryptoTable";
import { Pagination } from "@/components/Pagination";
import { FeedBanner } from "@/components/FeedBanner";
import { Delta } from "@/components/Delta";
import { Explainer } from "@/components/Explainer";
import { Metric, Panel, Stack } from "@/components/layout";
import { BreadthBar } from "@/components/BreadthBar";
import { PageHeader } from "@/components/editorial";
import { getExplainer } from "@/content/explainers";
import { dirOf, usd } from "@/lib/format";
import { getDict, PATHS } from "@/lib/i18n";
import { getCoins } from "@/lib/providers/crypto";
import type { Locale } from "@/lib/types";

/** Rows per page. The full set is fetched once and sliced here. */
const PER_PAGE = 50;

export async function CryptoView({ locale, page = 1 }: { locale: Locale; page?: number }) {
  const dict = getDict(locale);
  let coins = null;
  let error: string | undefined;
  try {
    // One cached 250-coin request rather than one request per page: CoinGecko's
    // free tier rate-limits aggressively, and paging server-side from a single
    // cached response costs nothing extra per page view.
    coins = await getCoins(250);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  const totalPages = Math.max(1, Math.ceil((coins?.length ?? 0) / PER_PAGE));
  const current = Math.min(Math.max(1, page), totalPages);
  const pageCoins = coins?.slice((current - 1) * PER_PAGE, current * PER_PAGE) ?? [];
  const hrefFor = (n: number) =>
    n > 1 ? `/${locale}/${PATHS.crypto[locale]}?page=${n}` : `/${locale}/${PATHS.crypto[locale]}`;

  // Headline metrics describe the WHOLE market, not the visible page — a
  // breadth count that changed as you paged would be meaningless.
  const btc = coins?.find((c) => c.id === "bitcoin");
  const eth = coins?.find((c) => c.id === "ethereum");
  const advancing = coins?.filter((c) => dirOf(c.changePct24h) === "up").length ?? 0;
  const declining = coins?.filter((c) => dirOf(c.changePct24h) === "down").length ?? 0;
  const unchanged = Math.max(0, (coins?.length ?? 0) - advancing - declining);

  return (
    <>
      <PageHeader title={dict.crypto.title} subtitle={dict.crypto.subtitle} />
      {coins?.length ? (
        <Stack>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            {btc && (
              <Metric
                label={`${btc.symbol} · ${btc.name}`}
                value={usd(btc.price, locale)}
                delta={<Delta change={btc.changePct24h} changePct={btc.changePct24h} locale={locale} showAbsolute={false} />}
              />
            )}
            {eth && (
              <Metric
                label={`${eth.symbol} · ${eth.name}`}
                value={usd(eth.price, locale)}
                delta={<Delta change={eth.changePct24h} changePct={eth.changePct24h} locale={locale} showAbsolute={false} />}
              />
            )}
          </div>

          <Panel>
            <BreadthBar up={advancing} down={declining} flat={unchanged} labels={{ up: dict.common.up, down: dict.common.down, flat: dict.common.flat }} />
          </Panel>

          <CryptoTable coins={pageCoins} locale={locale} dict={dict} />
          <Pagination page={current} totalPages={totalPages} hrefFor={hrefFor} dict={dict} />
        </Stack>
      ) : (
        <FeedBanner dict={dict} detail={error} />
      )}
      <Explainer content={getExplainer("crypto", locale)} />
    </>
  );
}
