# VIP conversion — feature epics, page by page

Goal: **more readers buy Plus or Pro.** One epic per page, each answering the only
question that matters on that page — *what does VIP mean HERE?*

Written 2026-09-09 against the running app, `npm run verify` green. Sizes are S/M/L
of engineering effort. **Owner: You** = needs an account, a key, or a pricing call;
**Owner: Build** = doable in-repo now.

---

## The finding that shapes every epic below

I counted tier/entitlement references per page view:

| View | tier refs | Paid surface? |
|---|---|---|
| `TerminalView` (chart) | 19 | **All of it** |
| `PricingView` | 13 | It *is* the checkout |
| `CoinDetail` | 2 | Inherits the chart |
| `CryptoView` | 1 | A comment, not a gate |
| `StocksBoard` | **0** | none |
| `GoldView` | **0** | none |
| `HeatmapView` | **0** | none |
| `BriefView` | **0** | none |
| `LoginView` | **0** | none |

**The entire paid product is one page.** Every other destination gives everything
away and never names VIP. A reader can arrive on gold or the brief from search, take
the full value, and leave without once learning that a paid tier exists. Those pages
are the top of the funnel and they are not connected to it.

Second finding: the paid line is already *declared* and it is a good one. From
`packages/core/src/auth/entitlement.ts` — free gets drawings and alerts on purpose,
and the paid line is drawn at **DEPTH** (how many), **REACH** (what we do while your
tab is closed) and **PORTABILITY** (does it follow you to another device). Every epic
below extends that same line rather than inventing a new one. A paywall a reader can
predict is a paywall they can decide about.

### Before any of this: revenue is blocked on credentials, not features

Three payment rails are coded and idempotent — MoMo, VNPay, SePay (`src/app/api/billing/`)
— plus a manual QR fallback. All four are inert without merchant keys. Same for the
foreign-flow overlay (`SSI_CONSUMER_ID`), which is fully wired and invisible for want
of a key.

**No epic here earns a dong until a purchase can complete.** If you do one thing this
week, provision one payment merchant and run a sandbox purchase. I would not start E1–E9
before that is done.

---

## E1 — Landing (`/vi`): say what VIP is on the first screen
**Owner: Build · M · the top of every funnel**

Today the landing sells free market data — a commodity in VN, where CafeF and Vietstock
give it away too. It shows breadth, a VN-INDEX/gold hero, watchlist onboarding, a heatmap
preview and the AI box. The only word about paying is "Gói Dịch Vụ" in the nav.

**Stories**
- As a first-time visitor, I see in one line what VIP does that free does not, so I know
  there is a product here and not just a data page.
- As a visitor using the AI box, I see "2 free questions" *before* I spend them, so the
  limit is an invitation rather than a surprise. (`FREE_ASK_LIMIT = 2`, `src/app/api/ask/route.ts:9`)
- As a signed-in free reader, the hero speaks about MY watchlist ("VNM moved +2.1% today"),
  so the page proves the account is worth something before it asks for money.

**Acceptance** — a VIP value strip above the fold; the AI box states remaining asks;
`upgrade_prompt_shown{surface:"landing"}` fires so the lever is measurable.

---

## E2 — Chart (`/vi/bieu-do/[symbol]`): finish the ladder that already exists
**Owner: Build · M · the product people actually pay for**

This page carries the whole paywall and it is in good shape: intraday, the indicator
library, multi-chart, compare, foreign flow and layout sync are all gated and all
explained by `GateHint`. The gaps are rungs missing from the middle of the ladder.

**Stories** (detailed in `docs/chart-backlog.md`)
- Draw a support line → arm an alert on it in one action. This is the single best place
  on the site to sell `alerts:email`, because the reader has just proved they care about
  that price. **(C5)**
- Relative-strength ratio against VNINDEX, not just an overlay. **(C8)**
- Name the corporate-event markers. **(C6)**
- `IndicatorMenu.tsx:101` still uses hard `disabled` — the same focus trap already fixed
  on the drawing rail. Locked rows cannot be focused or explained.

**Blocked, not missing: foreign flow (C3)** — wired at `TerminalView.tsx:21,390,405`,
gated at Plus, invisible without `SSI_CONSUMER_ID`. Confirm SSI's field names against a
real response on the first keyed call; `providers/ssi.ts:11-15` warns the schema came
from docs, not a live call.

---

## E3 — Stocks board (`/vi/chung-khoan`): the highest-intent page, doing no selling
**Owner: Build · M · likely the best ROI after E2**

"Bảng giá chứng khoán" is what people search. The view is 56 lines with zero tier logic:
a sector filter, a price table, sparklines, a watch star. Everything, free, to everyone.

**Stories**
- As a holder, I see a **foreign net buy/sell column** so I can sort the board by the flow
  that moves HOSE. *(Plus — same capability and same SSI key as E2, one more surface for
  a key you are already paying for.)*
- As a screener, I **save a filter** ("banks, foreign-buying, above MA20") and find it on
  my phone. *(Plus — this is PORTABILITY, `sync:docs`, exactly the declared line.)*
- As a free reader, I **add the whole visible board to my watchlist** in one tap, so the
  retention loop starts on the page with the most traffic.
- As a Pro subscriber, I **export the board to CSV** for my own sheet. *(Pro — DEPTH.)*

**Acceptance** — the foreign column is sortable and absent (not zeroed) without keys;
saved filters obey `LAYOUT_LIMIT`; export is server-side and rate-limited.

---

## E4 — Gold (`/vi/vang`): the premium IS the product
**Owner: Build · S–M · genuinely VN-specific**

`GoldView` is 101 lines: domestic SJC, world, and the premium between them. That premium
is the most VN-specific number on the whole site and it is shown as a single figure with
no history and no context.

**Stories**
- As a gold buyer, I see the **premium over time**, so I can tell whether today is unusual.
  *(Free: 30 days. Plus: full history — DEPTH, the same shape as the chart's gate.)*
- As a gold buyer, I get **alerted when the premium crosses a level** I set. *(Alert
  creation free; email delivery Plus — REACH, reusing the alerts cron unchanged.)*
- As a gold buyer, I see **where today's premium sits historically** ("wider than 92% of
  the last two years"), so the number means something. *(Plus.)*

**Why this converts** — gold buyers in VN are a distinct, motivated audience that no
equity terminal serves well, and the recorded gold series already exists in our own table
(`/api/bars` serves it from `db.series`).

---

## E5 — Heatmap (`/vi/ban-do-nhiet`): a poster that should be a workspace
**Owner: Build · M · engagement → habit**

38 lines. One static snapshot, a legend, a note. Nothing to do on it, so nobody returns.

**Stories**
- As a reader, I **switch the heatmap's period** (1D / 1W / 1M) to see what is rotating.
  *(Intraday periods Plus, matching `chart:intraday` — the gate readers already know.)*
- As a reader, I **drill into a sector** and get its members without leaving the page.
- As a subscriber, I **colour the map by foreign net flow** instead of price. *(Plus.)*
- As a subscriber, I **save a heatmap view**. *(Plus — `sync:docs`.)*

---

## E6 — Brief (`/vi/ban-tin`): the retention engine, currently anonymous
**Owner: Build · M · the strongest REACH story on the site**

`BriefView` is 158 lines of automatically composed daily market prose, with a cron that
already builds it. It is identical for every reader and it is not delivered anywhere.

**Stories**
- As a subscriber, my brief **leads with my watchlist**, so it is about my money.
  *(Plus — personalisation is the product.)*
- As a subscriber, the brief **arrives by email before the open**. *(Plus — pure REACH,
  the exact thing `alerts:email` already establishes, and the mailer is live.)*
- As a reader, I can **read past briefs**; free sees 7 days, Plus sees the archive. *(DEPTH.)*
- As a reader, I can **ask the AI about today's brief** in one tap. *(Ties E7 to a page
  people already read.)*

**Careful** — `BriefView`'s own copy promises it "describes recorded figures only — it
does not explain causes, forecast, or offer investment advice." Personalising the brief
must not quietly turn it into a recommendation engine. Keep the disclaimer true.

---

## E7 — AI (`/vi/hoi-ai`): the sharpest lever, currently spent silently
**Owner: Build · S · highest conversion-per-line-of-code**

`FREE_ASK_LIMIT = 2`. Two free questions, then the wall. This is the closest thing the
site has to a trial, and today the reader does not know they are on one.

**Stories**
- As a visitor, I see **how many free questions remain** before I spend one.
- As a visitor who has spent both, I see **what a VIP answer looks like** on a real
  example, not just a price.
- As a reader on the chart or board, I can **ask about the symbol in front of me** with
  it already in context.
- As a subscriber, my **question history follows me across devices**. *(Plus — `sync:docs`.)*

**Acceptance** — the counter is server-truth, not a client guess; the exhaustion state
is `GateHint`, never a modal (the component's own docstring explains why).

---

## E8 — Crypto (`/vi/crypto`): keep it free, invest nothing
**Owner: Build · XS · a deliberate no**

`CryptoView` is 80 lines; `CoinDetail` inherits the gated chart, which is enough. Crypto
is the least VN-specific surface we have, and the positioning doc is explicit: *we win by
being deepest on VN, not by out-featuring global tools.* Binance and TradingView own this.

**Recommendation** — keep crypto as a free cross-asset breadth play, because "chứng khoán
· vàng · crypto on one screen" is a real landing differentiator. Build no paid crypto
features. This epic exists to record the decision so it does not get re-litigated.

---

## E9 — Pricing (`/vi/goi-dich-vu`): the page that closes, and must never overpromise
**Owner: Build (+ You on prices) · M · every other epic ends here**

Plus 99.000₫/mo · 990.000₫/yr. Pro 199.000₫/mo · 1.990.000₫/yr (`billing/plans.ts`).

**Stories**
- As a shopper, I see a **capability table generated from `entitlement.ts`**, so the page
  physically cannot claim a feature the code does not grant. *(Phase 0 had to reword an
  overpromise about comparing symbols; generating the table makes that class of bug
  impossible rather than fixed once.)*
- As a shopper arriving **from a specific gate**, that row is highlighted — I was blocked
  by intraday, so intraday is what the page talks about first.
- As a shopper, I see the **annual saving** stated as a number. (`annualSavingPct()` exists.)
- As a shopper, I understand **renewal**: MoMo one-time payments do not auto-renew, access
  is time-boxed, and I will be reminded. Say it plainly — surprise expiry is a refund
  request and a bad review.

---

## E10 — Account & renewal (cross-page): make VIP feel owned
**Owner: Build · M · protects revenue you already have**

Acquisition is half the job; `PRICES` are time-boxed grants, so every subscriber expires
on a date. The renewals cron exists.

**Stories**
- As a subscriber, I see **days remaining** without hunting for it.
- As a subscriber, I get a **renewal nudge before** access lapses, not after.
- As a subscriber, I can see **my orders and receipts**.
- As the owner, I can **revoke** a grant when a payment is reversed. *(Work in progress and
  untracked — `src/app/api/billing/revoke/`, `RevokeButton.tsx`. It has had no security
  review, and revoking an entitlement is a privileged action. Review it before it ships.)*

---

## Sequencing

| # | Epic | Owner | Size | Why here |
|---|---|---|---|---|
| 0 | **Provision one payment merchant + sandbox purchase** | **You** | — | Nothing below earns anything until this is done |
| 1 | E7 AI counter + exhaustion state | Build | S | Cheapest lever on the site; the trial already exists |
| 2 | E9 Pricing generated from `entitlement.ts` | Build | M | Every other epic funnels here; also kills a bug class |
| 3 | E3 Board: foreign column + saved filters | Build | M | Highest-intent page, currently sells nothing |
| 4 | E6 Brief: watchlist-led + emailed | Build | M | Strongest REACH story; mailer is already live |
| 5 | E1 Landing VIP strip | Build | M | Widest reach, but wasted before 1–4 exist to point at |
| 6 | E4 Gold premium history + alerts | Build | S–M | Distinct audience nobody serves; data is ours |
| 7 | E2 Chart C5/C6/C8 | Build | M | Deepens a page that already converts |
| 8 | E10 Renewal & receipts | Build | M | Matters once there are subscribers to keep |
| 9 | E5 Heatmap workspace | Build | M | Engagement, furthest from revenue |
| — | E8 Crypto | — | — | Deliberate no |

**Cross-cutting:** every epic ships with its funnel events. PostHog is wired
(`analytics/posthog.ts`) and conversion instrumentation is mid-flight on this branch.
An epic without events is an epic you cannot judge.

## Won't do
Auto-renewing card subscriptions (MoMo does not support them; time-boxed is honest) ·
paid crypto features (E8) · personalised investment advice (not licensed) · gating the
basic price board behind a wall — free reach is the top of this funnel and starving it
to sell one more seat is a bad trade.
