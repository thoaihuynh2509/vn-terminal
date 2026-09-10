# Cổ Phiếu Việt

Vietnamese market terminal: **HOSE equities · gold · crypto** on one screen, in
Vietnamese and English. Next.js 16 App Router, Tailwind v4, deploys to Vercel.

Built as a data-first counterpart to magazine-style sites like tapchiphowall.com:
the live board is the product, not an accessory to articles.

## Quick start

```bash
npm install
cp .env.example .env.local   # optional; sensible defaults are built in
npm run dev                  # http://localhost:3000 → redirects to /vi
```

## Deploy to Vercel

The app is **fail-closed**: with nothing configured the board still serves, and
each unset integration degrades to a 501 or a "coming soon" — so you can ship
first and switch things on as accounts come online. Full detail:
[`docs/deploy-checklist.md`](docs/deploy-checklist.md) and
[`docs/database-setup.md`](docs/database-setup.md).

1. **Provision the database first** (Supabase — see the DB doc) so you have the
   two connection strings before importing.
2. **Import the repo**: vercel.com → *Add New… → Project* → import this repo.
   Next.js is auto-detected; leave Build/Output as-is — `vercel.json` sets the
   build command to run migrations then build, and registers the retention crons.
3. **Set environment variables** (Production). Minimum to run sign-in + accounts:

   | Var | Value |
   |---|---|
   | `AUTH_SECRET` | `openssl rand -hex 32` |
   | `NEXT_PUBLIC_SITE_URL` | your final origin (fix after step 5) |
   | `AUTH_PROVIDER` | `magic` |
   | `DATABASE_URL` | Supabase **transaction pooler** (`:6543`) |
   | `MIGRATE_DATABASE_URL` | Supabase **direct/session** (`:5432`) — advisory locks need a session |
   | `MAIL_PROVIDER` / `RESEND_API_KEY` / `MAIL_FROM` | Resend (magic link + retention mail) |
   | `CRON_SECRET` | `openssl rand -hex 32` (Vercel sends it as the cron Bearer) |

   Turn on when ready (each optional, fail-closed): `MOMO_*` / `VNPAY_*` /
   `SEPAY_*` (payments), `ADMIN_EMAILS` (`/:locale/admin`),
   `NEXT_PUBLIC_POSTHOG_KEY` (analytics funnel), `ASK_PROVIDER=claude` +
   `ANTHROPIC_API_KEY` (real AI; default `mock` ships free). Prices live in
   `src/lib/billing/plans.ts`.
4. **Deploy.**
5. Once you have the domain, set `NEXT_PUBLIC_SITE_URL` to it exactly and
   **redeploy** — magic links and payment returns are built from it.

Migrations run automatically on every deploy (idempotent; a no-op with no DB
URL). Verify locally any time with `npm run verify`.

## Routes

| Route | What it is |
|---|---|
| `/vi`, `/en` | Overview: indices, gold + crypto highlights, top movers |
| `/vi/chung-khoan`, `/en/stocks` | Sortable VN30 board with ceiling/floor flags |
| `/vi/chung-khoan/[symbol]` | Quote, candlestick chart, 90-session range |
| `/vi/vang`, `/en/gold` | SJC/DOJI/PNJ/Bảo Tín board + domestic-vs-world premium |
| `/vi/crypto`, `/en/crypto` | Top 50 by market cap with 7-day sparklines |
| `/vi/ban-tin`, `/en/market-brief` | Dated market brief, auto-composed from the day's figures |
| `/vi/hoi-ai`, `/en/ask` | Grounded market Q&A assistant |
| `/vi/ban-do-nhiet`, `/en/market-heatmap` | Treemap of the board — area by traded value, colour by change |
| `/vi/goi-dich-vu`, `/en/pricing` | Tier structure (billing not enabled) |
| `/vi/dang-nhap`, `/en/login` | Passwordless sign-in — emailed magic link (`dev` provider locally) |
| `/vi/dang-nhap/verify`, `/en/login/verify` | Confirms an emailed link; the Continue button POSTs the token |
| `/vi/theo-doi`, `/en/watchlist` | Watchlist — localStorage while signed out; synced to your account once signed in |

Segments are localised per locale, and the wrong pairing (`/vi/stocks`) 404s so
crawlers never see duplicate URLs. `sitemap.xml` and `robots.txt` are generated.

## UI

The layout follows tapchiphowall.com: a dark promo strip, a white header with
grouped nav disclosures, a live cross-asset ticker, then a two-column body with a
right rail (market snapshot, Ask-AI card, most-read, research links). Section
headers carry an accent bullet, an uppercase label and a "view all" link. Inter
for UI; there is no second family — the brief is a data read-out, not an essay.

Two deliberate departures from the reference:

- **Colours are the validated ones, not the reference's.** The reference's green
  (`#10b981`) sits near 2.3:1 on white. `--up`/`--down` keep the palette-validated
  hexes, which read the same at a glance and actually clear contrast.
- **No photo mastheads.** Board pages open on `PageHeader`; the stock-photo
  `PageHero` and its `ImageCredit` were removed so the data starts above the
  fold. `public/img/` and `src/content/image-credits.json` are left in place
  (untracked) in case a masthead ever returns — attribution lives there.

Surfaces use a `.card` class with a soft elevation that lifts on hover; data
tables get taller rows, a hover wash and sticky headers. Board pages open with a
short photographic masthead (capped at 176px so the data stays above the fold),
index tiles carry a 20-session sparkline, the stock board has a trend column, and
the symbol page has a peers rail. `QuoteTable` has a `compact` mode for narrow
columns — two full boards side by side in the home page's main column clipped
their own volume and trend columns.

Every horizontal scroller (`ticker`, tables, nav) is `position: relative`. Without
it the `.sr-only` spans inside — which are `position: absolute` — escape the
scroll container to their static position past the right edge and stretch the
document, which is exactly the `bodyOverflowX` regression the a11y suite caught.

## The chart terminal

`/vi/bieu-do/<SYMBOL>` is the product. A multi-pane SVG chart: candles / line /
area, a volume pane, and one pane per active oscillator. Every pane shares a
single x-scale and a single hovered index, so the crosshair and every read-out
move together — an oscillator that disagrees with its price pane about which bar
you are on is worse than no oscillator.

**Indicators** (`src/lib/ta/`) are implemented from their published definitions —
Wilder's RSI and ATR, Appel's MACD, Bollinger's bands. These are mathematical
methods, not anyone's proprietary code. Two invariants are unit-tested:

- Every series is returned at the **same length as its input**, `null`-padded
  where undefined. That is what lets the chart align an overlay to its bars by
  index; without it, overlays silently render one candle out of place.
- Wilder's smoothing is Wilder's, not a simple moving average — a common
  substitution that produces a visibly jumpier RSI.

`registry.ts` is the single catalogue driving the toolbar, the entitlement gate
and the renderer, so an indicator cannot appear in the UI without the chart
knowing how to draw it.

**Drawing tools** (Pro) store coordinates in **data space** — a timestamp and a
price — never pixels. A pixel-space drawing looks right until the reader changes
the range or resizes, then silently detaches from the bar it was drawn against.
`drawings.test.ts` pins the geometry, including segment-clamped hit testing so a
trendline is only "hit" between its endpoints, and tolerant parsing so corrupt
storage yields an empty canvas rather than a crash.

**Multi-chart layouts** (Pro) keep the chosen symbols in the URL, so a workspace
is shareable and survives a reload. A non-Pro request for a grid collapses to a
single chart rather than erroring — the capability is upsold, not punished.

**Price alerts** (Plus and above) are evaluated in the browser against the
prices the page has loaded, and the panel says exactly that. Anyone who believes
an alert will reach them overnight has been misled by the feature, so the scope
note is part of the UI and a test asserts it is present. `evaluate()` is a pure
function so the identical logic can move to a server worker when background
delivery exists, with no rewrite. `cross_up`/`cross_down` require an actual
crossing between two observations — a level alert on a price already past its
threshold fires immediately and forever, which is rarely what anyone means.

**What is deliberately not built:** this is not a TradingView clone. No copied
layout, no copied code, no Pine Script, no scraped chart data. Charting
*functionality* is not protectable; a specific product's expression is.

## Auth and the paywall

**Sessions** are stateless signed cookies — HMAC-SHA256 via Web Crypto, no
dependency and no session table. `httpOnly` + `SameSite=Lax` + `Secure` in
production. The payload is readable but any edit invalidates the signature, so a
tier is only trustworthy after `decodeSession`. Verification is constant-time.

**There is no password anywhere in this codebase.** The `dev` provider is
passwordless and refuses to run when `NODE_ENV=production` — an unauthenticated
"become anyone" endpoint on a live site is a total auth bypass. Its tier
selector writes the tier to the account row and the session is then minted from
that row, so a tier always comes from the record and never from the request.

**Magic links** are the real provider. `POST /api/auth/magic/request` answers
`200 {ok:true}` for every well-formed address — new, known, over the rolling-hour
ceiling or undeliverable — because any other branch answers "does this account
exist?" for whoever asks. Only the SHA-256 of the token is stored, and the link
is never in a response body. The emailed link opens a page with a Continue
button that form-POSTs to `/api/auth/magic/verify`; that route has no GET
handler, because Safe Links, Gmail prefetch and AV scanners follow GET links and
would burn the token before the reader arrives. Redemption is one conditional
UPDATE, so a replay finds nothing, and the response is a 303 — a 307 would
re-POST the form at the destination.

The link is a bearer credential, so production refuses to mint one it cannot
deliver safely: the `console` driver prints it to the server log and is the
default only outside production, and the origin comes from
`NEXT_PUBLIC_SITE_URL` with no fallback, because a guessed one mails a live
token to a domain the deployment may not own. Either missing, and
`/api/auth/magic/request` answers 501 instead of sending.

A missing `AUTH_SECRET` in production means *sessions are unavailable* (everyone
anonymous), not a crash. An earlier version threw, and because the layout
resolves the session on every request that turned one missing env var into a
site-wide 500.

**The paywall is enforced server-side.** `previewHtml` cuts the body at a block
boundary before it is sent; the gated text never reaches the wire. Rendering the
full article and hiding the rest with CSS is not a paywall — the text sits in
view-source and in every scraper's output.

**Metering** follows Google's flexible sampling: one canonical URL per article,
`isAccessibleForFree: false` plus a `hasPart` paywall selector, and three free
member reads tracked in the signed cookie. Member articles are deliberately NOT
disallowed in `robots.txt` — splitting paid content onto a robots-blocked path
(as the reference site does) forfeits its organic authority entirely.

The proxy only *counts*; the page decides what to serve from the same signed
cookie, so a forged request cannot talk its way past the gate.

*Known limit:* an anonymous reader can reset the meter by clearing cookies. That
is inherent to cookie metering without accounts and is why metering is a soft
allowance — the hard gate is entitlement, which is signed and re-checked on
every request.

**The AI endpoint is gated first** — before parsing, before touching a feed, long
before a token is spent. It is the only route whose cost scales with use.

## Verification

```bash
npm run verify        # typecheck + lint + unit tests + production build
npm run test:unit     # gold unit-conversion regression tests
npm run test:actions  # 13 interaction checks driven over CDP
npm run test:a11y     # per-page accessibility audit (18 pages)
npm run test:paywall  # paywall + session forgery suite (needs AUTH_SECRET)
npm run test:magic    # magic-link routes: enumeration, single use, 303, 501
npm run shots         # screenshots, both themes, desktop + mobile
```

`scripts/test-magic.mjs` starts its own `next start` (so it needs a build) and
reads the console mail driver's stdout — the only place the raw link exists.

`scripts/cdp.mjs` drives headless Chrome over the DevTools Protocol with no test
dependencies. 26 interaction checks, including that the pricing page states
billing is disabled and exposes no payment link, and that every heatmap tile
prints its own percentage rather than relying on colour. The interaction suite covers the theme toggle, locale switch,
board sorting with `aria-sort`, the watchlist round trip, and the chart's
keyboard crosshair, table view and line mode. Both suites need the app running
(`npm run build && npx next start -p 3210`, or set `BASE`).

## Disclaimer

Aggregated from public sources, may lag real time, not investment advice.
