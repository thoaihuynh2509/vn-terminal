# SEO — what can be engineered, and what cannot

Goal as asked: rank #1 on Google for investing searches in Vietnam.

Written 2026-09-09 against the running site, audited page by page.

## The honest part first

**A #1 ranking cannot be built in a commit.** Google ranks on authority, links and
track record as much as on markup, and those accrue over months. What engineering
controls is whether the site is *eligible* to rank: crawlable, indexable, correctly
described, fast, and carrying unique data nobody else has. That part I can finish.
The rest is a domain, a publishing habit, and time.

So this file separates the two. Everything under "Fixed" and "Buildable" is mine.
Everything under "Yours" is not, and no amount of schema substitutes for it.

---

## The single biggest problem is the domain

The site serves from **`vn-terminal.vercel.app`** (`packages/core/src/site.ts`,
`DEFAULT_SITE_URL`, used whenever `NEXT_PUBLIC_SITE_URL` is unset).

Every canonical, every hreflang, every sitemap entry and every breadcrumb now points
there. A `vercel.app` subdomain is shared infrastructure — it carries no independent
authority, cannot accrue domain-level trust, and competes for VN finance queries
against CafeF, Vietstock, 24hMoney and VnExpress, all of which have a decade of links
on their own domains.

**Nothing else in this file matters as much.** Buy the domain, set
`NEXT_PUBLIC_SITE_URL`, redeploy, and verify in Search Console. Until then the
technical work below is groundwork on rented land.

`docs/deploy-checklist.md` §1 already lists this: *"`NEXT_PUBLIC_SITE_URL` — your real
origin, e.g. `https://vnterminal.vn`"*.

---

## Which queries are actually winnable

Ranking is per query, not per site, and "invest" splits into two very different sets.

**Not winnable in the near term** — head terms owned by publishers with a decade of
authority, where a new domain does not place regardless of markup:
`chứng khoán` · `đầu tư chứng khoán` · `giá vàng hôm nay` · `bảng giá chứng khoán`

**Winnable, and where the effort belongs** — long-tail and unique-data queries where
the competition is thin and the site has something genuinely nobody else publishes:

| Query shape | Why we can win it |
|---|---|
| `VNM cổ phiếu`, `biểu đồ HPG`, `FPT giá` | 60 VN30 chart URLs already in the sitemap; low competition per symbol |
| `chênh lệch giá vàng SJC thế giới` | The premium is COMPUTED here (`gold-math.ts`); most sites publish only the raw price |
| `khối ngoại mua ròng [mã]` | Foreign flow is wired and Plus-gated; almost nobody charts it per symbol |
| `độ rộng thị trường VNINDEX` | Breadth is computed here and rarely published |
| `VN30 bảng giá` | Narrower than the head term, and it is exactly what the board is |

The strategy is 60 small wins, not one big one. That is also the honest way to
approach it: a terminal that answers a specific question well will outrank a news
site for that specific question long before it outranks anything for "chứng khoán".

---

## Fixed in this change

The audit found the site's SEO foundations in good shape — canonicals are per-page
and correct, hreflang is complete, the sitemap covers VN30 × both locales, robots is
sane, every page has exactly one `h1`, and the boards carry `FAQPage` through
`Explainer`. Phase 0 clearly did real work here. Two gaps remained:

1. **The 60 chart URLs had no structured data at all** — the largest cohort in the
   sitemap and the entire long-tail play. They now emit `BreadcrumbList`
   (`packages/core/src/seo.ts`, rendered from `TerminalView`).
2. **The home page had none either** — the one page where a publisher graph is worth
   having. It now emits `Organization` + `WebSite`.

Deliberately **not** included:

- **No `SearchAction`.** Symbol search is a client-side palette, not a URL a crawler
  can call. Declaring a search endpoint that cannot answer produces a rich result that
  fails on click.
- **No price or quote in the graph.** The site's own disclaimer says the feed may lag.
  A `price` in JSON-LD is a claim about a number at a moment; a breadcrumb is true
  whatever the market did. Structured data that can be wrong is worse than none.
- **Crumbs never point at `/{locale}/bieu-do`** — it 307s to a default symbol, and a
  crumb pointing at a redirect spends the credit it exists to earn. Pinned by a test.

---

## Buildable next, in order

| # | Work | Size | Why here |
|---|---|---|---|
| 1 | **Per-symbol prose + FAQ on chart pages** | M | The 60 URLs rank on markup alone today. `Explainer` already exists and gives boards a `FAQPage`; charts have no text at all. **Caveat below.** |
| 2 | **Longer meta descriptions** | S | Currently 39–52 chars where ~150 is the target; Google rewrites short ones. Note `views/meta.ts` deliberately ties description to the visible subtitle so they cannot drift — so this means richer subtitles, not a second string. |
| 3 | **`Dataset` schema on gold + breadth** | S | These are genuinely unique series. `Dataset` is how you tell Google you publish data rather than repeat it. |
| 4 | **Core Web Vitals pass** | M | Never measured. `ChartPro` is 2,300 lines of client component on the money pages, and the panes are un-memoised (flagged by the perf lens). LCP/INP on a mid-range Android over 4G is the real test. |
| 5 | **`ItemList` on the board** | S | Describes the price table as a ranked list rather than an opaque grid. |
| 6 | **Internal linking** | S | Charts link out to the board, but the board's 30 rows do not each link to their chart with descriptive anchor text. That is 30 internal links per page, free. |

**Caveat on #1.** Per-symbol prose must be generated from data the site actually has —
price action, band, volume, foreign flow — never invented company descriptions. Thirty
fabricated company essays would be both a quality penalty and, on a finance site, a
credibility problem. If it cannot be honestly derived, it should not be written.

---

## Yours, and not substitutable

1. **Buy a domain and point `NEXT_PUBLIC_SITE_URL` at it.** Everything else is
   downstream of this.
2. **Google Search Console** — verify the property, submit `/sitemap.xml`, then watch
   Coverage and Query reports. Without it you are optimising blind; the reports tell
   you which of the winnable queries above are actually landing.
3. **Backlinks.** The one ranking factor no code change touches. For a VN finance
   tool: forum answers where the data actually helps, a free embeddable gold-premium
   widget, and being the source someone cites for foreign-flow numbers.
4. **Publishing cadence.** `/ban-tin` already auto-composes a daily brief from real
   figures. A dated, indexable archive of those — one URL per trading day — is the
   cheapest content engine here, and it is already three-quarters built.

---

## What to expect

A new domain with correct technical SEO typically sees indexation in weeks and
meaningful long-tail traffic in three to six months. Head terms take years or never.
Anyone promising #1 on a timeline is selling something.

The realistic target is: **first page for `[symbol] cổ phiếu` on most of the VN30, and
first position for the gold-premium and foreign-flow queries nobody else answers.**
That traffic converts better than head-term traffic anyway — someone searching
`khối ngoại mua ròng HPG` wants exactly what Plus unlocks.
