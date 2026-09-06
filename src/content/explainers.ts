import type { Locale } from "@/lib/types";

/**
 * Evergreen explainer content rendered beneath each board.
 *
 * This is the answer-engine surface: the board earns the ranking, the explainer
 * earns the citation. Kept to durable mechanics (price bands, unit conversions,
 * how a metric is defined) rather than market opinion or regulatory claims,
 * because those age badly and nobody is on staff to revise them.
 */
export interface Faq {
  q: string;
  a: string;
}
export interface Explainer {
  title: string;
  intro: string;
  sections: { heading: string; body: string[] }[];
  faqs: Faq[];
}

const stocksVi: Explainer = {
  title: "Đọc bảng giá chứng khoán Việt Nam",
  intro:
    "Bảng giá phía trên hiển thị rổ VN30 trên sàn HOSE. Phần dưới đây giải thích các quy ước mà một bảng giá Việt Nam sử dụng: giá tham chiếu, biên độ dao động, trần và sàn.",
  sections: [
    {
      heading: "Giá tham chiếu, trần và sàn",
      body: [
        "Giá tham chiếu là mốc để tính mọi thay đổi trong phiên. Trên HOSE và HNX, đó là giá đóng cửa của phiên giao dịch liền trước.",
        "Mỗi sàn giới hạn mức dao động trong một phiên: HOSE ±7%, HNX ±10%, UPCoM ±15%. Mức cao nhất được phép gọi là giá trần, mức thấp nhất là giá sàn.",
        "Khi một mã chạm trần hoặc sàn, lệnh vẫn được đặt nhưng không thể khớp ngoài biên độ đó. Bảng giá này đánh dấu các trạng thái đó bằng nhãn chữ chứ không chỉ bằng màu.",
      ],
    },
    {
      heading: "Đơn vị yết giá",
      body: [
        "Giá cổ phiếu Việt Nam được yết theo nghìn đồng. Con số 62,70 trên bảng nghĩa là 62.700 đồng cho một cổ phiếu.",
        "Khối lượng được tính theo số cổ phiếu. Trên HOSE, lô giao dịch chuẩn là 100 cổ phiếu.",
      ],
    },
    {
      heading: "Chu kỳ thanh toán",
      body: [
        "Giao dịch cổ phiếu tại Việt Nam thanh toán theo chu kỳ T+2: cổ phiếu mua ở phiên T về tài khoản trong ngày làm việc thứ hai sau đó, và chỉ khi đó mới bán lại được.",
        "Vì vậy giá trên bảng phản ánh giao dịch đã khớp, không phải số dư có thể bán ngay của bạn.",
      ],
    },
  ],
  faqs: [
    {
      q: "Biên độ dao động của sàn HOSE là bao nhiêu?",
      a: "HOSE giới hạn ±7% so với giá tham chiếu trong một phiên. HNX là ±10% và UPCoM là ±15%.",
    },
    {
      q: "Giá cổ phiếu Việt Nam yết theo đơn vị nào?",
      a: "Theo nghìn đồng. Giá hiển thị 62,70 tương đương 62.700 đồng một cổ phiếu.",
    },
    {
      q: "Giá trần và giá sàn nghĩa là gì?",
      a: "Giá trần là mức cao nhất và giá sàn là mức thấp nhất mà một mã được phép khớp trong phiên, tính từ giá tham chiếu theo biên độ của sàn niêm yết.",
    },
    {
      q: "Mua cổ phiếu hôm nay thì khi nào bán được?",
      a: "Theo chu kỳ thanh toán T+2, cổ phiếu về tài khoản vào ngày làm việc thứ hai sau ngày khớp lệnh và có thể bán từ thời điểm đó.",
    },
  ],
};

const stocksEn: Explainer = {
  title: "Reading a Vietnamese stock board",
  intro:
    "The board above tracks the VN30 basket on HOSE. This section explains the conventions a Vietnamese board uses: the reference price, the daily band, and the ceiling and floor.",
  sections: [
    {
      heading: "Reference price, ceiling and floor",
      body: [
        "The reference price is the baseline every intraday move is measured against. On HOSE and HNX it is the previous session's closing price.",
        "Each exchange caps how far a stock may move in one session: HOSE ±7%, HNX ±10%, UPCoM ±15%. The highest permitted price is the ceiling, the lowest is the floor.",
        "A stock at its ceiling or floor still accepts orders, but none can match beyond the band. This board marks those states with a text label rather than colour alone.",
      ],
    },
    {
      heading: "Quotation units",
      body: [
        "Vietnamese equities are quoted in thousands of dong. A board price of 62.70 means 62,700 VND per share.",
        "Volume is counted in shares. The standard HOSE board lot is 100 shares.",
      ],
    },
    {
      heading: "Settlement cycle",
      body: [
        "Vietnamese equities settle T+2: shares bought on day T reach the account on the second following business day, and only then can be sold.",
        "Board prices therefore reflect matched trades, not your immediately sellable balance.",
      ],
    },
  ],
  faqs: [
    { q: "What is the HOSE daily price band?", a: "HOSE limits moves to ±7% from the reference price in a session. HNX is ±10% and UPCoM is ±15%." },
    { q: "What unit are Vietnamese stock prices quoted in?", a: "Thousands of dong. A displayed price of 62.70 equals 62,700 VND per share." },
    { q: "What do ceiling and floor prices mean?", a: "They are the highest and lowest prices a stock may trade at during a session, set from the reference price by the listing exchange's band." },
    { q: "When can I sell shares I buy today?", a: "Under T+2 settlement the shares arrive on the second business day after the trade and can be sold from then." },
  ],
};

const goldVi: Explainer = {
  title: "Hiểu giá vàng Việt Nam",
  intro:
    "Vàng trong nước được yết theo đồng trên một lượng, còn vàng thế giới yết theo đô la Mỹ trên một ounce troy. Muốn so sánh hai con số, cần quy đổi cả đơn vị khối lượng lẫn tiền tệ.",
  sections: [
    {
      heading: "Lượng, chỉ và ounce",
      body: [
        "Một lượng (còn gọi là cây) bằng 37,5 gam và chia thành 10 chỉ, mỗi chỉ 3,75 gam.",
        "Một ounce troy bằng 31,1035 gam. Vì vậy một lượng nặng hơn một ounce: 37,5 chia 31,1035 bằng khoảng 1,20565 ounce.",
        "Để qui giá vàng thế giới ra đồng trên lượng, ta nhân giá mỗi ounce với 1,20565 rồi nhân tiếp với tỷ giá USD/VND. Nhân chứ không chia — đây là chỗ rất dễ nhầm, và nhầm sẽ khiến mức chênh lệch bị thổi phồng nhiều lần.",
      ],
    },
    {
      heading: "Giá mua vào và bán ra",
      body: [
        "Mỗi thương hiệu công bố hai mức: giá mua vào là giá họ mua lại vàng từ bạn, giá bán ra là giá bạn phải trả để mua.",
        "Khoảng cách giữa hai mức, gọi là chênh lệch, chính là chi phí thực tế khi mua rồi bán ngay. Chênh lệch rộng ra thường đi kèm những giai đoạn thị trường biến động mạnh.",
      ],
    },
    {
      heading: "Chênh lệch trong nước và thế giới",
      body: [
        "Sau khi quy đổi, giá vàng trong nước thường cao hơn giá thế giới. Phần vượt đó gọi là mức chênh lệch, phản ánh nguồn cung, nhu cầu nội địa và chi phí trung gian.",
        "Tỷ giá USD/VND dùng để quy đổi là số liệu tham khảo, không phải giá giao dịch. Trang này hiển thị rõ tỷ giá đã dùng để bạn tự kiểm chứng con số.",
      ],
    },
  ],
  faqs: [
    { q: "Một lượng vàng bằng bao nhiêu gam?", a: "Một lượng bằng 37,5 gam, tương đương 10 chỉ, mỗi chỉ 3,75 gam." },
    { q: "Một lượng bằng bao nhiêu ounce?", a: "Khoảng 1,20565 ounce troy, vì 37,5 gam chia cho 31,1035 gam mỗi ounce." },
    { q: "Quy đổi giá vàng thế giới sang đồng mỗi lượng thế nào?", a: "Nhân giá mỗi ounce troy với 1,20565 để ra giá mỗi lượng tính bằng đô la, rồi nhân với tỷ giá USD/VND." },
    { q: "Chênh lệch mua vào bán ra nghĩa là gì?", a: "Đó là khoảng cách giữa giá cửa hàng mua lại và giá bán ra, tức chi phí bạn chịu nếu mua rồi bán ngay lập tức." },
  ],
};

const goldEn: Explainer = {
  title: "Understanding Vietnamese gold prices",
  intro:
    "Domestic gold is quoted in dong per tael, while world gold is quoted in US dollars per troy ounce. Comparing the two requires converting both the weight unit and the currency.",
  sections: [
    {
      heading: "Tael, chi and troy ounce",
      body: [
        "One lượng (tael, also called a cây) is 37.5 grams and divides into 10 chỉ of 3.75 grams each.",
        "One troy ounce is 31.1035 grams, so a tael is heavier than an ounce: 37.5 divided by 31.1035 is about 1.20565 ounces.",
        "To convert world gold to dong per tael, multiply the per-ounce price by 1.20565 and then by the USD/VND rate. Multiply, never divide — inverting this ratio inflates the apparent premium several times over.",
      ],
    },
    {
      heading: "Bid and ask",
      body: [
        "Each brand publishes two prices: the bid is what they pay to buy gold back from you, the ask is what you pay to buy.",
        "The gap between them, the spread, is the real cost of buying and immediately selling. Spreads typically widen in volatile periods.",
      ],
    },
    {
      heading: "The domestic premium",
      body: [
        "Once converted, domestic gold usually trades above world parity. That excess is the premium, and it reflects local supply, domestic demand and intermediation costs.",
        "The USD/VND rate used for the conversion is a reference figure, not a dealt rate. This page shows the rate it used so the number can be checked.",
      ],
    },
  ],
  faqs: [
    { q: "How many grams is one tael of gold?", a: "One tael (lượng) is 37.5 grams, made up of 10 chỉ of 3.75 grams each." },
    { q: "How many troy ounces are in a tael?", a: "About 1.20565 troy ounces, since 37.5 grams divided by 31.1035 grams per ounce gives 1.20565." },
    { q: "How do I convert world gold to dong per tael?", a: "Multiply the price per troy ounce by 1.20565 to get the price per tael in dollars, then multiply by the USD/VND rate." },
    { q: "What does the bid-ask spread mean?", a: "It is the gap between the price a dealer buys back at and the price they sell at — the cost you bear if you buy and sell immediately." },
  ],
};

const cryptoVi: Explainer = {
  title: "Đọc bảng thị trường crypto",
  intro:
    "Bảng phía trên xếp hạng tài sản số theo vốn hóa thị trường. Dưới đây là ý nghĩa của từng cột và những giới hạn khi diễn giải chúng.",
  sections: [
    {
      heading: "Vốn hóa thị trường",
      body: [
        "Vốn hóa bằng giá hiện tại nhân với lượng cung đang lưu hành. Đây là thước đo quy mô, không phải số tiền đã được đầu tư vào tài sản đó.",
        "Vì chỉ tính phần cung đang lưu hành, hai tài sản cùng mức giá có thể có vốn hóa rất khác nhau.",
      ],
    },
    {
      heading: "Khối lượng và thanh khoản",
      body: [
        "Khối lượng 24 giờ là tổng giá trị đã giao dịch trong một ngày, thường dùng để ước lượng mức độ thanh khoản.",
        "Tỷ lệ khối lượng trên vốn hóa cao cho thấy tài sản được giao dịch sôi động so với quy mô của nó.",
      ],
    },
    {
      heading: "Stablecoin và đường xu hướng",
      body: [
        "Stablecoin được thiết kế để bám sát một tài sản tham chiếu, thường là đô la Mỹ, nên biến động của chúng gần như bằng không. Trên bảng này, mức thay đổi làm tròn về 0 được hiển thị trung tính thay vì tô màu tăng hoặc giảm.",
        "Đường xu hướng 7 ngày chỉ thể hiện hình dạng của giá đóng cửa, không có trục giá trị; hãy đọc kèm cột phần trăm bên cạnh.",
      ],
    },
  ],
  faqs: [
    { q: "Vốn hóa thị trường của một đồng crypto được tính thế nào?", a: "Bằng giá hiện tại nhân với lượng cung đang lưu hành." },
    { q: "Khối lượng 24 giờ nghĩa là gì?", a: "Là tổng giá trị giao dịch của tài sản đó trong 24 giờ gần nhất, thường được dùng để ước lượng thanh khoản." },
    { q: "Vì sao stablecoin hiển thị mức thay đổi bằng 0?", a: "Vì chúng bám theo một tài sản tham chiếu nên biến động rất nhỏ; khi làm tròn về 0 thì bảng hiển thị trung tính thay vì tô màu tăng giảm." },
  ],
};

const cryptoEn: Explainer = {
  title: "Reading the crypto market table",
  intro:
    "The table above ranks digital assets by market capitalisation. Here is what each column means and where the interpretation has limits.",
  sections: [
    {
      heading: "Market capitalisation",
      body: [
        "Market cap is the current price multiplied by circulating supply. It measures scale, not the amount of money invested in an asset.",
        "Because only circulating supply counts, two assets at the same price can have very different market caps.",
      ],
    },
    {
      heading: "Volume and liquidity",
      body: [
        "24-hour volume is the total value traded in a day and is commonly used as a rough liquidity proxy.",
        "A high volume-to-market-cap ratio indicates an asset trading actively relative to its size.",
      ],
    },
    {
      heading: "Stablecoins and sparklines",
      body: [
        "Stablecoins are designed to track a reference asset, usually the US dollar, so their moves are near zero. This board renders a change that rounds to zero as neutral rather than tinting it up or down.",
        "The 7-day sparkline shows only the shape of closing prices and carries no value axis; read it alongside the percentage column.",
      ],
    },
  ],
  faqs: [
    { q: "How is a cryptocurrency's market cap calculated?", a: "Current price multiplied by circulating supply." },
    { q: "What does 24-hour volume mean?", a: "The total value of that asset traded over the last 24 hours, commonly used as a liquidity proxy." },
    { q: "Why do stablecoins show a zero change?", a: "They track a reference asset, so moves are tiny; when the change rounds to zero the board shows it neutrally instead of tinting it up or down." },
  ],
};

const EXPLAINERS = {
  stocks: { vi: stocksVi, en: stocksEn },
  gold: { vi: goldVi, en: goldEn },
  crypto: { vi: cryptoVi, en: cryptoEn },
} as const;

export function getExplainer(key: keyof typeof EXPLAINERS, locale: Locale): Explainer {
  return EXPLAINERS[key][locale];
}
