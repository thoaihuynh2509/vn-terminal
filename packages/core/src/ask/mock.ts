import { getGold, headlineRow } from "@/lib/providers/gold";
import { getBoard, getIndices, VN30 } from "@/lib/providers/vnstock";

/**
 * Deterministic stand-in for the model.
 *
 * It is NOT canned text — it answers from the same live figures the real
 * provider would receive, so the grounding path, the units, the refusal
 * behaviour and the UI can all be exercised and tested without an API key or a
 * per-request cost. Intentionally narrow: it recognises a handful of intents and
 * says so plainly when it recognises none, which is what the real assistant is
 * also instructed to do rather than guess.
 */
type Intent = "advice" | "gainers" | "losers" | "index" | "gold" | "symbol" | "unknown";

const ADVICE = /(nên mua|nên bán|có nên|khuyến nghị|dự báo|sẽ tăng|sẽ giảm|should i (buy|sell)|recommend|forecast|predict|price target|good buy)/i;

function classify(q: string): { intent: Intent; symbol?: string } {
  const s = q.toLowerCase();
  if (ADVICE.test(s)) return { intent: "advice" };
  if (/(tăng mạnh|tăng nhiều|dẫn đầu|gainer|top up|biggest gain)/.test(s)) return { intent: "gainers" };
  if (/(giảm mạnh|giảm sâu|loser|biggest (drop|fall|decline))/.test(s)) return { intent: "losers" };
  if (/(vn ?index|vn30|hnx|upcom|chỉ số|index)/.test(s)) return { intent: "index" };
  if (/(vàng|gold|sjc|doji|pnj|xau)/.test(s)) return { intent: "gold" };
  // A ticker is either already uppercase in the question ("VNM", "ZZZ"), or it
  // matches a symbol we actually track. Uppercasing the whole question first
  // turned any three-letter Vietnamese word into a ticker — "hôm nay" was read
  // as the symbol NAY.
  const known = new Set<string>(VN30);
  for (const token of q.match(/\b[A-Za-z]{3}\b/g) ?? []) {
    const upper = token.toUpperCase();
    if (token === upper || known.has(upper)) return { intent: "symbol", symbol: upper };
  }
  return { intent: "unknown" };
}

const n = (v: number, d = 2) => v.toFixed(d);
const sign = (v: number) => (v >= 0 ? "+" : "");

export async function answerFromSnapshot(question: string, locale: "vi" | "en"): Promise<string> {
  const vi = locale === "vi";
  const { intent, symbol } = classify(question);

  if (intent === "advice") {
    return vi
      ? "Mình chỉ tường thuật số liệu thị trường, không đưa ra khuyến nghị mua bán và không dự báo giá. Bạn có thể hỏi về mức giá hiện tại, biến động trong phiên, hoặc cách một chỉ số được tính."
      : "I only report market figures — I don't make buy or sell recommendations and I don't forecast prices. You can ask about a current level, a session move, or how a figure is calculated.";
  }

  if (intent === "index") {
    const idx = await getIndices().catch(() => []);
    if (!idx.length) return vi ? "Hiện chưa lấy được dữ liệu chỉ số." : "Index data is unavailable right now.";
    const body = idx.map((i) => `${i.symbol} ${n(i.price)} (${sign(i.changePct)}${n(i.changePct)}%)`).join(" · ");
    return vi ? `Các chỉ số hiện tại: ${body}.` : `Current index levels: ${body}.`;
  }

  if (intent === "gainers" || intent === "losers") {
    const board = await getBoard().catch(() => []);
    if (!board.length) return vi ? "Hiện chưa lấy được bảng giá." : "The board is unavailable right now.";
    const sorted = [...board].sort((a, b) => b.changePct - a.changePct);
    const rows = intent === "gainers" ? sorted.slice(0, 5) : sorted.slice(-5).reverse();
    const body = rows.map((q) => `${q.symbol} ${n(q.price)} (${sign(q.changePct)}${n(q.changePct)}%)`).join(", ");
    return vi
      ? `${intent === "gainers" ? "Tăng mạnh nhất" : "Giảm sâu nhất"} trong rổ VN30: ${body}. Giá tính theo nghìn đồng một cổ phiếu.`
      : `${intent === "gainers" ? "Biggest gainers" : "Biggest decliners"} in the VN30: ${body}. Prices are in thousands of dong per share.`;
  }

  if (intent === "gold") {
    const gold = await getGold().catch(() => null);
    if (!gold) return vi ? "Hiện chưa lấy được giá vàng." : "Gold prices are unavailable right now.";
    const top = headlineRow(gold.rows);
    if (!top) return vi ? "Hiện chưa lấy được giá vàng." : "Gold prices are unavailable right now.";
    const tr = (v: number) => `${n(v / 1e6)} triệu`;
    const m = (v: number) => `${n(v / 1e6)}M VND`;
    return vi
      ? `${top.name}: mua vào ${tr(top.buy)}, bán ra ${tr(top.sell)} một lượng (cập nhật ${gold.updatedAt}).` +
          (gold.world ? ` Vàng thế giới quanh ${n(gold.world.buy)} USD một ounce.` : "")
      : `${top.name}: bid ${m(top.buy)}, ask ${m(top.sell)} per tael (updated ${gold.updatedAt}).` +
          (gold.world ? ` World gold is near ${n(gold.world.buy)} USD per ounce.` : "");
  }

  if (intent === "symbol" && symbol) {
    const board = await getBoard().catch(() => []);
    const hit = board.find((q) => q.symbol === symbol);
    if (!hit) {
      return vi
        ? `Mã ${symbol} không có trong rổ VN30 mà trang này theo dõi, nên mình không có số liệu cho mã đó.`
        : `${symbol} is not in the VN30 basket this site tracks, so I have no figures for it.`;
    }
    return vi
      ? `${hit.symbol} đang ở ${n(hit.price)} nghìn đồng, thay đổi ${sign(hit.change)}${n(hit.change)} (${sign(hit.changePct)}${n(hit.changePct)}%) so với tham chiếu.`
      : `${hit.symbol} is at ${n(hit.price)} thousand dong, changed ${sign(hit.change)}${n(hit.change)} (${sign(hit.changePct)}${n(hit.changePct)}%) against the reference.`;
  }

  return vi
    ? "Mình chưa hiểu câu hỏi. Mình có số liệu về chỉ số Việt Nam, rổ VN30, cùng giá vàng trong nước và thế giới. Ví dụ: “Mã nào tăng mạnh nhất?” hoặc “Giá vàng SJC hôm nay?”."
    : "I didn't follow that. I have Vietnam index levels, the VN30 board, and domestic and world gold. Try: “Which stocks gained most?” or “What is the SJC gold price?”.";
}
