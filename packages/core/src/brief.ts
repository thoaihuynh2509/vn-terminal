import type { Coin, GoldRow, GoldSnapshot, Locale, Quote } from "./types";
import { num, pct, usd, vnd, volume as fmtVol } from "./format";
import { breadthDivergence, sectorStats, SECTOR_LABEL, turnoverLeaders } from "./sectors";

/**
 * Composes the daily market brief.
 *
 * Every sentence is derived arithmetically from the figures on the page — counts,
 * extremes, averages. It states no forecast, no causation and no recommendation,
 * because nothing here knows why the market moved. That restraint is what makes
 * an auto-written brief publishable without an editor reviewing it.
 */
/** Stable id so a renderer can pair a paragraph with a chart without matching translated headings. */
export type BriefSection = "indices" | "breadth" | "rotation" | "flow" | "gold" | "crypto";

export interface BriefParagraph {
  id: BriefSection;
  heading: string;
  sentences: string[];
}

export interface Brief {
  headline: string;
  standfirst: string;
  paragraphs: BriefParagraph[];
}

function breadth(board: Quote[]) {
  const up = board.filter((q) => q.changePct > 0).length;
  const down = board.filter((q) => q.changePct < 0).length;
  return { up, down, flat: board.length - up - down };
}

export function buildBrief(
  locale: Locale,
  { indices, board, gold, goldHeadline, coins, premiumPct }:
  {
    indices: Quote[];
    board: Quote[];
    gold: GoldSnapshot | null;
    /** The brand the boards headline (SJC 9999), not simply the dearest row. */
    goldHeadline?: GoldRow;
    coins: Coin[];
    premiumPct?: number;
  },
): Brief {
  const vi = locale === "vi";
  const vnindex = indices.find((i) => i.symbol === "VNINDEX");
  const { up, down, flat } = breadth(board);
  const sorted = [...board].sort((a, b) => b.changePct - a.changePct);
  const best = sorted[0];
  const worst = sorted[sorted.length - 1];
  const btc = coins.find((c) => c.symbol === "BTC");
  const eth = coins.find((c) => c.symbol === "ETH");
  const goldTop = goldHeadline ?? gold?.rows[0];

  const dir = (v: number) => (vi ? (v > 0 ? "tăng" : v < 0 ? "giảm" : "đi ngang") : v > 0 ? "rose" : v < 0 ? "fell" : "was unchanged");

  const paragraphs: BriefParagraph[] = [];

  if (vnindex) {
    paragraphs.push({
      id: "indices",
      heading: vi ? "Chỉ số" : "Indices",
      sentences: [
        vi
          ? `VNINDEX đóng ở ${num(vnindex.price, locale)} điểm, ${dir(vnindex.change)} ${num(Math.abs(vnindex.change), locale)} điểm (${pct(vnindex.changePct, locale)}).`
          : `The VNINDEX stands at ${num(vnindex.price, locale)}, having ${dir(vnindex.change)} ${num(Math.abs(vnindex.change), locale)} points (${pct(vnindex.changePct, locale)}).`,
        ...indices
          .filter((i) => i.symbol !== "VNINDEX")
          .map((i) =>
            vi
              ? `${i.symbol} ở ${num(i.price, locale)}, ${dir(i.change)} ${pct(i.changePct, locale)}.`
              : `${i.symbol} is at ${num(i.price, locale)}, ${dir(i.change)} ${pct(i.changePct, locale)}.`,
          ),
      ],
    });
  }

  if (board.length && best && worst) {
    paragraphs.push({
      id: "breadth",
      heading: vi ? "Độ rộng thị trường" : "Market breadth",
      sentences: [
        vi
          ? `Trong ${board.length} mã theo dõi, ${up} mã tăng, ${down} mã giảm và ${flat} mã đứng giá.`
          : `Of the ${board.length} tracked tickers, ${up} advanced, ${down} declined and ${flat} were unchanged.`,
        vi
          ? `${best.symbol} dẫn đầu với mức ${pct(best.changePct, locale)}, trong khi ${worst.symbol} giảm sâu nhất ở ${pct(worst.changePct, locale)}.`
          : `${best.symbol} led the group at ${pct(best.changePct, locale)}, while ${worst.symbol} lagged at ${pct(worst.changePct, locale)}.`,
      ],
    });
  }

  // ── sector rotation ───────────────────────────────────────────────────────
  // The genuinely proprietary part: computed from our own board, published free
  // nowhere in Vietnamese, and purely descriptive — no forecast, no advice.
  if (board.length >= 8) {
    const sectors = sectorStats(board).filter((x) => x.count >= 2);
    const best = sectors[0];
    const worst = sectors[sectors.length - 1];
    const label = (k: typeof best.key) => SECTOR_LABEL[k][vi ? "vi" : "en"];
    const s: string[] = [];

    if (best && worst && best.key !== worst.key) {
      s.push(
        vi
          ? `Dẫn dắt phiên là nhóm ${label(best.key)} với mức ${pct(best.weightedChangePct, locale)} (bình quân theo giá trị giao dịch), trong khi ${label(worst.key)} ở mức ${pct(worst.weightedChangePct, locale)}.`
          : `${label(best.key)} led at ${pct(best.weightedChangePct, locale)} on a turnover-weighted basis, while ${label(worst.key)} sat at ${pct(worst.weightedChangePct, locale)}.`,
      );
    }
    for (const sec of sectors.slice(0, 4)) {
      s.push(
        vi
          ? `${label(sec.key)}: ${pct(sec.weightedChangePct, locale)}, ${sec.advancing} tăng / ${sec.declining} giảm trên ${sec.count} mã.`
          : `${label(sec.key)}: ${pct(sec.weightedChangePct, locale)}, ${sec.advancing} up / ${sec.declining} down of ${sec.count}.`,
      );
    }
    if (s.length) paragraphs.push({ id: "rotation", heading: vi ? "Luân chuyển nhóm ngành" : "Sector rotation", sentences: s });
  }

  // ── where the money actually went ─────────────────────────────────────────
  if (board.length >= 5) {
    const leaders = turnoverLeaders(board, 3);
    const s = [
      vi
        ? `Giá trị giao dịch tập trung ở ${leaders.map((q) => q.symbol).join(", ")}.`
        : `Turnover concentrated in ${leaders.map((q) => q.symbol).join(", ")}.`,
      ...leaders.map((q) =>
        vi
          ? `${q.symbol}: ${num(q.price, locale)} nghìn đồng, ${pct(q.changePct, locale)}, khối lượng ${fmtVol(q.volume ?? 0, locale)}.`
          : `${q.symbol}: ${num(q.price, locale)}k VND, ${pct(q.changePct, locale)}, volume ${fmtVol(q.volume ?? 0, locale)}.`,
      ),
    ];
    if (vnindex) {
      const div = breadthDivergence(vnindex.changePct, board);
      if (div === "narrow-rally") {
        s.push(vi
          ? "Chỉ số tăng nhưng số mã giảm nhiều hơn số mã tăng — mức tăng tập trung ở một số ít cổ phiếu."
          : "The index rose while decliners outnumbered advancers — the gain was concentrated in a few names.");
      } else if (div === "narrow-selloff") {
        s.push(vi
          ? "Chỉ số giảm nhưng số mã tăng nhiều hơn số mã giảm — mức giảm tập trung ở một số ít cổ phiếu."
          : "The index fell while advancers outnumbered decliners — the decline was concentrated in a few names.");
      }
    }
    paragraphs.push({ id: "flow", heading: vi ? "Dòng tiền" : "Where the money went", sentences: s });
  }

  if (goldTop) {
    const s = [
      vi
        ? `${goldTop.name} niêm yết bán ra ${vnd(goldTop.sell, locale)} một lượng, mua vào ${vnd(goldTop.buy, locale)}.`
        : `${goldTop.name} is quoted at ${vnd(goldTop.sell, locale)} per tael to sell and ${vnd(goldTop.buy, locale)} to buy.`,
      vi
        ? `Chênh lệch mua bán ở mức ${vnd(goldTop.sell - goldTop.buy, locale)}.`
        : `The bid-ask spread stands at ${vnd(goldTop.sell - goldTop.buy, locale)}.`,
    ];
    if (gold?.world) {
      s.push(
        vi
          ? `Vàng thế giới giao dịch quanh ${usd(gold.world.buy, locale)} một ounce.`
          : `World gold trades near ${usd(gold.world.buy, locale)} per ounce.`,
      );
    }
    if (premiumPct !== undefined) {
      s.push(
        vi
          ? `Sau quy đổi, giá trong nước cao hơn giá thế giới khoảng ${pct(premiumPct, locale)}.`
          : `After conversion, the domestic price sits about ${pct(premiumPct, locale)} above world parity.`,
      );
    }
    paragraphs.push({ id: "gold", heading: vi ? "Vàng" : "Gold", sentences: s });
  }

  if (btc) {
    paragraphs.push({
      id: "crypto",
      heading: "Crypto",
      sentences: [
        vi
          ? `Bitcoin ở ${usd(btc.price, locale)}, ${dir(btc.changePct24h)} ${pct(btc.changePct24h, locale)} trong 24 giờ.`
          : `Bitcoin is at ${usd(btc.price, locale)}, having ${dir(btc.changePct24h)} ${pct(btc.changePct24h, locale)} over 24 hours.`,
        ...(eth
          ? [
              vi
                ? `Ethereum ở ${usd(eth.price, locale)}, ${dir(eth.changePct24h)} ${pct(eth.changePct24h, locale)}.`
                : `Ethereum is at ${usd(eth.price, locale)}, ${dir(eth.changePct24h)} ${pct(eth.changePct24h, locale)}.`,
            ]
          : []),
      ],
    });
  }

  const headline = vnindex
    ? vi
      ? `VNINDEX ${dir(vnindex.change)} ${pct(Math.abs(vnindex.changePct), locale).replace("+", "")} — ${up} mã tăng, ${down} mã giảm`
      : `VNINDEX ${dir(vnindex.change)} ${pct(Math.abs(vnindex.changePct), locale).replace("+", "")} — ${up} up, ${down} down`
    : vi
      ? "Bản tin thị trường"
      : "Market brief";

  return {
    headline,
    standfirst: vi
      ? "Bản tin được tổng hợp tự động từ số liệu trên trang. Chỉ mô tả những gì đã xảy ra, không dự báo và không khuyến nghị."
      : "Automatically compiled from the figures on this site. It describes what happened only — no forecasts, no recommendations.",
    paragraphs,
  };
}
