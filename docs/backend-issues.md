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

## 2026-09-07 — P2-8 spike: corporate-action data DOES exist on a free feed

- **Question the spike had to answer:** does any free feed publish dividends / ex-dates as data?
  The roadmap allows markers only if one does, and forbids a scraper if none does.
- **Method:** `scripts/probe-events.mjs` (read-only, kept in the repo so the answer can be
  re-checked when a feed drifts). Seven candidate endpoints across DNSE, VNDirect, CafeF, SSI
  iBoard and Vietstock, two symbols each.
- **Answer: YES**, on exactly one of them — VNDirect finfo v4 `/events`:
  `https://api-finfo.vndirect.com.vn/v4/events?q=code:VNM&size=50&sort=effectiveDate:desc`.
  Returns `type` (`DIVIDEND`/`STOCKDIV`/`KINDDIV`/`ISSUE`/`MEETING`/`LISTED`/`schedDiv`),
  `effectiveDate` (= ngày GDKHQ, the ex-right date), `dividend` (VND/share), `ratio`, `note`.
  Verified current, not an archive: VNM's latest row is 2026-06-26, 1,850 đ/cp.
- **Rejected, with the reason:** DNSE and CafeF have no corporate-action route (404); SSI iBoard
  answers `Request not found`; Vietstock answers **HTML**, which is the scraper the roadmap rules
  out. A first pass wrongly recorded VNDirect as a NO too — the query was malformed and the
  endpoint answered 500, not 404. *A 500 means the route exists;* only a 404 is evidence of absence.
- **Two feed quirks the parser must handle, both load-bearing:**
  1. Every event is published **twice, once per locale** (`.VN` and `.EN_GB`). Drawn naively each
     dividend appears on the chart twice. `parseEvents` dedupes on (date, kind, cash) and keeps the
     row matching the reader's language.
  2. `size` is capped at **50** server-side regardless of what is asked for.
- **The finding that constrains what a marker may CLAIM:** the daily series we chart is
  **back-adjusted for cash dividends**. Checking VNM's 2025-10-16 (2,500 đ) and 2026-06-26
  (1,850 đ) ex-dates against DNSE, previous close → ex-day open moved +0.05 and +0.35, where an
  unadjusted series would have gapped by the full dividend. So a marker explains **no** drop on the
  chart — there is none to explain. Labels therefore state the event and the amount and never imply
  causation. (An earlier read appeared to show a gap; it was a UTC/ICT off-by-one — bar timestamps
  must be bucketed in `Asia/Ho_Chi_Minh`, which `ictDay()` now does.)
- **Status:** SHIPPED 2026-09-07 as P2-8. `packages/core/src/chart/events.ts` (pure, 16 tests),
  `packages/core/src/providers/events.ts` (cached 24h, fails soft to `[]`), markers rendered on the
  price pane axis. Re-run the probe if markers ever stop appearing.

## 2026-09-07 — `npm run test:a11y` reported 15 fake findings when the dev server was down

- **Symptom:** with nothing listening on `BASE` (3210), the audit reported identical issues on all
  15 pages — `imgNoAlt: 2`, `lang: 'en'` even on `/vi`. Chrome's own "can't be reached" page is
  valid HTML with one `h1`, a `lang` and two images, so every column looked like a real finding and
  the failure pointed at the app instead of at the missing server.
- **Assessment:** the suite failed in the safe direction (exit 1, never a false green), but it
  misattributed the cause, which costs a full stash-and-baseline cycle to disprove.
- **Status:** FIXED 2026-09-07. The audit now loads one page first and aborts with
  `AUDIT ABORTED: <BASE> did not serve the app` unless the app's own chrome is present. Both paths
  were exercised: green with the server up, clean abort with `BASE=http://localhost:3999`.

## 2026-09-07 — P1-6's saved-layout UI was never built, so its gate is unreachable

- **Where:** `src/components/chart/ChartRail.tsx:20` — `type Tab = "watch" | "alerts" | "ask"`.
  There is no `LayoutsTab`, and no file under `src/components/chart/` creates a `layout` doc.
- **Symptom:** the SERVER half of P1-6 shipped and is correct — `DOC_KINDS` includes `layout` and
  `template`, `docs.ts:99` enforces `LAYOUT_LIMIT` (anon 0 / free 1 / plus 5 / pro 25) across the
  shared setup pool, and `/api/docs` re-checks it. But nothing in the UI ever writes one, so no
  reader can reach that gate and `LAYOUT_LIMIT` still has no product consumer — the same condition
  P1-6 was written to fix, now moved one layer up.
- **Why it matters to P2-10:** the roadmap draws P2-10's paid line as "tuning is free, SAVING the
  tuned set is the gate (P1-6 templates)". Half of that is real today. Tuning is free for every
  tier and the tuned setup does persist, via `settings/chart` (P1-5) — per device for everyone,
  and synced across devices for plus+ through `sync:docs`. What does not exist is a NAMED saved
  setup, so the sentence in the roadmap overstates today's product.
- **Deliberately not papered over:** a pricing row advertising saved setups was considered and
  rejected. P0-1 existed precisely to delete claims the product does not honour, and adding one
  back for an unbuilt feature would be the same defect. The honest differentiator for a tuned
  setup today is the existing "Đồng bộ đa thiết bị" (`sync:docs`) row, which is accurate.
- **Status:** RESOLVED 2026-09-07. `src/components/chart/LayoutsTab.tsx` is the missing consumer:
  a "Bố cục" rail tab that saves, opens, renames and deletes named setups. `LAYOUT_LIMIT` is now
  reachable — free hits its single slot and is told why — so the pricing matrix gained an honest
  "Bố cục đã lưu 1/5/25" row alongside the existing drawings and alerts counts.
  Two notes on the shape it took. What is captured is the ADDRESS BAR, not chart internals: P1-12
  already made the URL the source of truth for symbol, interval, indicators, grid and range, so
  the rail cannot fall out of step with what is on screen. And `useSyncedDoc` is deliberately not
  used — it reconciles ONE document on a debounce, which suits drawings; saving a layout is a
  deliberate click, and there is one document per name, so the tab pushes on save and merges the
  account's list once on mount.
  **Still unverified end to end:** the synced (plus+) path writes through `/api/docs`, which needs
  migration 006. `MIGRATE_DATABASE_URL` is still malformed in production, so cross-device layouts
  cannot be exercised against a real database yet. The merge rule itself is unit-tested, and the
  path fails soft — a reader whose sync is unavailable keeps working locally and sees no error.
