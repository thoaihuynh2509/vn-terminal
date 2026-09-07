# Out-of-scope findings

Findings surfaced by a review lens that the run which found them did not cause and did not fix.
Each entry: what · where · symptom · evidence · date · status.

---

## 2026-09-05 — Tier-gated intraday bars are served from a public CDN cache

- **Where:** `src/app/api/bars/route.ts:26` — returns `ok(bars, 60)`; `ok()` in `src/lib/api.ts:8`
  emits `Cache-Control: public, s-maxage=60, stale-while-revalidate=300`, with no `Vary: Cookie`.
- **Symptom:** the route gates intraday timeframes on the session tier at lines 16-20, then marks
  the paid response publicly cacheable. A Plus subscriber's request for
  `/api/bars?symbol=VNM&tf=5m` populates the shared edge entry keyed on the URL alone. For the next
  60s (300 more while-revalidating), any anonymous client requesting the identical URL is served
  that intraday data from the edge — the route never executes, so the 402 at line 18 never fires.
  Scripted across the VN30 list this is a continuous free feed of the paid product.
- **Evidence:** `review-security`, this repo, 2026-09-05. Confirm with a Plus cookie then replay the
  same URL cookie-less through the deployed edge: `curl -sI` should show `x-vercel-cache: HIT` and a
  200 body. After a fix the second request must be 402.
- **Why it was not fixed here:** pre-existing; outside the auth/database diff that was reviewed.
- **Suggested fix:** return intraday responses with `Cache-Control: private, no-store` — the pattern
  `src/app/api/watchlist/route.ts:19` already uses — or put the tier in the cache key and add
  `Vary: Cookie`. The first is safer.
- **Status:** FIXED 2026-09-06. `/api/bars` returns `okPrivate` (private, no-store) for
  intraday timeframes, so the gated payload never populates the shared edge cache; daily
  (ungated) bars stay publicly cacheable.

## 2026-09-05 — `getSession()` in the locale layout makes all 49 routes dynamic

- **Where:** `src/app/[locale]/layout.tsx:61` — `await getSession()` calls `cookies()`
  (`src/lib/auth/session.ts:11`).
- **Symptom:** a dynamic API in a layout opts the whole segment subtree into dynamic rendering.
  `.next/prerender-manifest.json` holds only 5 routes (`/_global-error`, `/_not-found`,
  `/favicon.ico`, `/robots.txt`, `/sitemap.xml`) — **zero `[locale]` pages are prerendered**, so
  `export const revalidate = 60` on the board/stocks/gold/crypto pages and `generateStaticParams()`
  in the layout are dead letters. Every board and chart view is a full RSC render plus a serverless
  invocation instead of a 60s CDN hit; the board render does `topMovers`, `buildBrief`, heatmap and
  sector aggregation each time.
- **Not affected:** upstream feeds. `src/lib/cache.ts` gives a process-local TTL cache with
  single-flight, so the unofficial VN endpoints are protected. The cost is server CPU, invocation
  count and TTFB — not upstream fan-out or rate-limit exposure.
- **Evidence:** `review-perf`, this repo, 2026-09-05, read from `.next/prerender-manifest.json`.
- **Why it was not fixed here:** pre-existing — the README already described the layout resolving
  the session on every request, before this change. The fix is a product decision, not a patch.
- **Suggested fix:** enable `experimental.ppr`, move `getSession()` out of the layout body into an
  async `<SessionChrome/>` (Header + WatchlistSync) wrapped in `<Suspense>`, so the shell prerenders
  and the session chrome streams — this changes first paint, so a human approves it. Alternative:
  accept dynamic rendering and delete the misleading `revalidate = 60` exports.
- **Status:** OPEN, needs a human decision.

## 2026-09-05 — Login form placeholder is not localised

- **Where:** `src/components/LoginForm.tsx:94` — `placeholder="ban@example.com"`; same shape at
  line 112 where the dev tier buttons render raw `free`/`plus`/`pro` though `dict.pricing.*` exists.
- **Symptom:** a user-visible string not sourced from `getDict(locale)`, which DESIGN.md rule 7
  states without exception. It renders the Vietnamese-flavoured `ban@` on `/en/login`.
- **Evidence:** `review-conventions`, 2026-09-05. Confirmed pre-existing by the orchestrator: the
  file read at session start, before any edit, already contained this placeholder.
- **Status:** PARTIAL 2026-09-06. Email placeholder now localized via `dict.auth.emailPlaceholder`;
  the dev-only tier buttons still render raw `free/plus/pro` (dev provider never runs in prod).

## 2026-09-05 — A magic-link ceiling can lock one account out of sign-in for an hour

- **Where:** `src/lib/auth/magic.ts` — `MAX_LINKS_PER_EMAIL_PER_HOUR = 5`, consumed by
  `countRecent` in `src/app/api/auth/magic/request/route.ts`.
- **Symptom:** the counter is keyed on the address alone, so five unauthenticated requests naming
  `victim@example.com` exhaust that address's hourly budget. The victim's own request then sends
  nothing and — by design — still answers `200 {ok:true}` "check your inbox", so they wait for mail
  that never arrives.
- **Evidence:** `review-security`, 2026-09-05.
- **Assessment:** the accepted trade-off in most magic-link systems, recorded as a design decision
  rather than a defect. Narrowing it: raise the ceiling, add a per-(email, IP) sub-limit, or tell
  the address owner in a "you already have an unexpired link" mail — never in the HTTP body.
- **Status:** ACCEPTED, revisit if abuse is observed.

## 2026-09-05 — `npm run test:actions` asserts a nav dropdown the header does not render

- **Where:** `scripts/cdp.mjs:466-470` clicks
  `document.querySelector('header nav button[aria-expanded]')`.
- **Symptom:** that selector is `null`, so the suite throws
  `TypeError: Cannot read properties of null (reading 'click')` and exits 1. Because it throws
  rather than recording a failed check, **every assertion after line 467 never runs** and the
  results table is never printed.
- **Evidence:** `grep -c aria-expanded src/components/Header.tsx` → **0**. The nav renders flat
  `<Link>` elements (Header.tsx:88-96); the only `aria-expanded` in the codebase is in
  `chart/TimeframePicker.tsx`, `chart/ChartPro.tsx`, `chart/IndicatorMenu.tsx`. The cdp viewport is
  1440×1200 (cdp.mjs:77), so this is not a responsive-hiding issue.
- **Why it is not from the auth/database change:** that diff added a null-rendering `<WatchlistSync>`
  to `src/app/[locale]/layout.tsx` and edited nothing in `Header.tsx`.
- **Related drift:** `README.md` still describes "a white header with grouped nav disclosures". The
  header appears to have been simplified without updating its test or its documentation.
- **Suggested fix:** either restore the grouped-nav disclosure in `Header.tsx`, or drop the check
  from `cdp.mjs` and the claim from `README.md`. Separately, `check()` should record a failure
  instead of letting a null selector throw, so one stale assertion cannot mask the rest of the suite.
- **Status:** **RESOLVED 2026-09-07.** The check was retargeted at the chart's interval menu (a
  disclosure that does exist), every selector in it is null-safe, and `check()` now streams one line
  per assertion so a stalled step is identifiable instead of looking like a hang. Unblocking it
  revealed that **81 assertions had never executed**; four more stale selectors were fixed with it
  (see the next entry) and the suite now runs all 96 checks to completion.

## 2026-09-07 — four `test:actions` checks assert toolbar read-outs that were never built

- **Where:** `scripts/cdp.mjs` — "wheel up zooms in", "wheel down zooms back out", "the zoom level is
  shown in the toolbar" (they read `[aria-label="Khoảng"] [aria-pressed=true]`), and "a custom
  interval is served real bars" (it matches `/([0-9.,]+) nến/` in `main`).
- **Symptom:** all four return `undefined`/`null`. They are the last red checks in the suite
  (92 pass / 4 fail).
- **Cause:** neither read-out exists in the UI. `ChartPro`'s toolbar has only a `120 bars`/`All`
  toggle — there is no numbered range group and no bar-count label. Corroborating evidence: the
  dictionary keys `chart.range` ("Khoảng"), `chart.bars` ("nến") and `chart.sessions` ("phiên") are
  all defined in **both** locales and have **no rendering consumer** anywhere in `src/`. The checks
  and the strings were evidently written for a range control that was never finished.
- **Assessment:** not a regression and not a stale selector — the tests are ahead of the product.
  They describe exactly the control the chart roadmap builds as **P1-13** (range presets
  1M/3M/6M/1Y/YTD/All, plus a visible bar count), which will turn all four green and give the three
  orphaned dictionary keys their consumer.
- **Status:** **RESOLVED 2026-09-07 by P1-13.** The range control now exists — named presets
  (1M/3M/6M/1Y/YTD/All) in a `role="group" aria-label="Khoảng"`, plus a bar-count read-out — so
  `chart.range` and `chart.bars` finally have consumers, and "the zoom level is shown in the
  toolbar" and "a custom interval is served real bars" pass against real UI.
  Two of the four had to be **retargeted rather than satisfied**, and the reason matters: the
  presets are *named*, and a wheel-scroll lands between them, where lighting up "3M" would be a
  lie — so the honest zoom read-out is the bar count, not the pressed pill. The wheel itself is
  also undrivable here (Chrome never acknowledges `Input.dispatchMouseEvent` into the chart's
  non-passive listener), so those two now drive `+`/`-`, which run the same `zoomAt` through a
  path a keyboard user actually uses. The wheel's own contract — that it must not scroll the
  page — is still asserted separately and passes.
  `npm run test:actions` is now **98/98 green**.
