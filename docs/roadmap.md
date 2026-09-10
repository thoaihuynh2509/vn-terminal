# Cổ Phiếu Việt — product roadmap

Written as a prioritized backlog, not a wish list. A good roadmap says **no** as
much as yes. **Owner** = who unblocks it: **You** (accounts, money, product
calls) or **Build** (engineering, doable in-repo).

> **Name.** The product name lives in `packages/core/src/brand.ts` and nowhere
> else; a test fails the build if a literal reappears in any source file. The
> working name here is a placeholder — change that one file when you decide, and
> buy the matching domain (see `docs/seo-plan.md`, which explains why the domain
> outranks every other item on this page).

## Positioning (the one-liner that decides scope)
The best **Vietnam-focused** cross-asset terminal — HOSE equities · gold on one
screen — with an **AI read** no other VN site has. We win by being deepest
on VN, not by out-featuring global tools. **We will not clone TradingView's
expression, Pine Script, or scrape licensed data** — charting *functionality* is
built from first principles; a competitor's *expression* is theirs.

## Already shipped (verified: typecheck, lint, 345 tests, build, a11y 15/15)
Billing (MoMo + VNPay + SePay, idempotent grant) · subscriptions with self-
expiring session · retention crons (alerts, brief, renewals, teaser) · referral ·
admin reconciliation · free-AI teaser · workspace split (`@vnt/core`) · landing +
board UX (verdict, cross-asset hero, breadth bar, live refresh, AI box, watchlist,
nudge) · **15+ chart indicators** (SMA/EMA/VWAP/Bollinger/Keltner/Donchian/
Supertrend/Stochastic/CCI/Williams%R/ADX/OBV/RSI/MACD/ATR) · drawing tools ·
multi-chart · paywall · magic-link auth · i18n vi/en · docs + deploy checklist.

---

## P0 — Launch (blocks first real revenue)
| Task | Owner | Notes |
|---|---|---|
| Fix intraday-bars edge-cache leak (paid data served free) | ✅ Build (done) | `okPrivate` on gated bars — `docs/backend-issues.md` #1 |
| Provision Supabase, Resend, ≥1 payment merchant, secrets | **You** | `docs/deploy-checklist.md` — nothing ships without these |
| Deploy to Vercel + custom domain, run one sandbox purchase | **You** | migrations auto-run via `vercel.json` |
| Decide launch prices | **You** | `packages/core/src/billing/plans.ts` |

## P1 — Next (grow conversion & retention; buildable now)
| Task | Owner | Value / notes |
|---|---|---|
| **Analytics/funnel instrumentation** (view→signup→checkout→paid) | Build | You cannot optimize what you cannot see. Pick a tool (Plausible/PostHog); I wire events. **Decision: which tool.** |
| **Onboarding**: first-visit prompt to pick 3 watchlist symbols | Build | Activates the retention loop immediately |
| **VN-specific chart edge** (TradingView doesn't do these well): ceiling/floor ±7% lines; VNINDEX-relative overlay | Build | Legit, uses existing data; touches `ChartPro` — I'll scope carefully |
| **Foreign net buy/sell** overlay (khối ngoại) | Build* | *Pending: confirm a data source exists; won't promise until checked |
| AlertPanel copy: reflect email delivery for subscribers | Build | **After** cron+mailer confirmed live in prod (else it over-claims) |
| SEO: per-symbol titles/OG, article JSON-LD polish | Build | Organic acquisition |
| Dunning: retry/notice on failed renewal | Build | Recover churn |

## P2 — Later (scale & experiments)
Referral leaderboard · annual-plan pricing experiments · PWA/installable ·
real-time tick data (a **paid licensed feed** — You) · PPR to make board pages
static again (`backend-issues.md` #2 — needs a first-paint decision) · shared
rate-limit store when multi-node · more locales · reduce bundle.

## Won't do (deliberate)
Clone TradingView UI/Pine Script · scrape licensed chart data · personalized
investment advice (not licensed) · features whose data we don't own.

## Quality/ops debt (from `docs/backend-issues.md`)
- `test:actions` asserts a nav dropdown the header no longer renders (#5) — fix or
  drop the stale check so the suite can run green.
- Login dev-tier buttons render raw `free/plus/pro` (#3, partial) — placeholder
  now localized; tidy the tier labels too.
- Error tracking (Sentry) + uptime monitoring before scaling ad spend — **You** picks tool.

---
### How to use this
Pick from **P1** and I build it now. **P0 is mostly yours** (accounts/deploy) —
that is the real gate to income, not more engineering. I will not "build
everything": half of what's left is either done, needs your accounts, or needs a
product decision flagged above.
