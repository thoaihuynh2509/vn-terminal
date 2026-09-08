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
- **Status:** PARTIALLY ADDRESSED 2026-09-08, and the full fix was ATTEMPTED AND REVERTED.

  **Done:** the session read moved out of the layout body into a suspended
  `<SessionChrome>`, and the 16 `revalidate` exports on `[locale]` pages were
  deleted. They never applied — they claimed a caching policy the app does not
  have — and deleting a lie is worth doing even when the truth is unchanged.
  The page now streams instead of blocking on a cookie read.

  **Attempted:** the real fix. In this Next version PPR is `cacheComponents`,
  not `experimental.ppr` — the suggestion above was stale. Enabling it and
  working through the migration DID work: prerendered routes went from 5 to 53,
  every page gained a static shell, and the build was green. It took ~60 files:
  removing `revalidate`/`dynamic`/`runtime` segment configs (incompatible),
  `await connection()` on the components that read live feeds, `"use cache"` on
  the footer's copyright year, and Suspense boundaries with `params`/
  `searchParams` read INSIDE them on every dynamic route.

  **Why it was reverted:** it silently turned two 404s into 200s.
  `/vi/admin` — whose entire contract is "the page never admits it exists" —
  and `/vi/chart/VNM`, the wrong locale/segment pairing that `guard()` 404s to
  stop crawlers seeing a duplicate URL. Both are decided from request data, and
  under Cache Components a request read "always sits behind a `<Suspense>`
  boundary and streams" (Next's own authentication-with-cache-components
  guide), so the shell has already gone out with a 200 by the time `notFound()`
  runs. `export const instant = false` does not fix this: it opts a segment out
  of instant-navigation VALIDATION, not out of streaming. Verified against a
  production build, not just dev.

  **UPDATE 2026-09-08 — the authorization blocker is now GONE, and a different
  one took its place.** Route-level authorization moved into `src/proxy.ts`
  (commit "Decide route-level authorization in the proxy"), so both 404s are now
  decided before rendering and survive Cache Components: re-verified against a
  production build with the flag ON — `/vi/admin` 404, `/vi/gold` 404,
  `/vi/chart/VNM` 404, an allowlisted owner 200. Prerendered routes went 5 → 53
  again and the build was green.

  It was reverted anyway, for a worse reason: **suspended content renders but
  never hydrates.** On `/vi/chung-khoan` the board's 30 rows appear, and the
  Suspense fallback stays in the DOM beside them as a visible empty box, a
  direct child of `<main>`, above the table. Sorting a column and starring a
  symbol both do nothing — the client never takes over the subtree. Reproduced
  in `next dev` AND in `next start` against a production build, with no
  hydration error or warning in the console, and with a trivial `<p>…</p>`
  fallback as well as the real one, so it is neither a dev artifact nor
  something about the placeholder component.

  That is a worse defect than the one being fixed: a dead board is not a
  trade-off against a faster first paint. Something about how these boundaries
  are structured here does not settle on the client, and finding it needs a
  minimal reproduction rather than more edits to this app.

  **RESOLVED as a framework issue 2026-09-08 — reproduction in
  `docs/repro/cache-components-hydration/`.** It is not our boundary placement.

  With `cacheComponents: true`, a Suspense boundary that ACTUALLY STREAMS — one
  whose fallback is genuinely rendered because the child suspends — leaves the
  fallback in the DOM and never hydrates the streamed subtree. Client components
  inside it render and are inert. No hydration error or warning is logged.

  Five routes isolate it, in ~40 lines with no application code. A client
  component directly under Suspense hydrates. An async server child that awaits
  a resolved promise hydrates — because a microtask settles before React needs
  the fallback, so the boundary never actually streams. An async child that
  awaits `connection()`, or merely a 50ms timer, does not. So the trigger is not
  `connection()`, not Suspense, and not async server components: it is the
  boundary streaming at all.

  The control is a single flag on identical code:

      cacheComponents: true   ->  fallback still in DOM, counter stuck at 0
      cacheComponents: false  ->  fallback removed,      counter increments

  This is exactly the shape the Cache Components docs recommend for request-time
  data, so the migration cannot proceed until it is fixed upstream or a
  different pattern is documented. Everything else needed is proven and rebuilt
  in about an hour: the proxy gates (already shipped), the `connection()` marks,
  the `use cache` on the footer year, and the page restructuring.

  **Superseded — the original blocker:** move route-level authorization into `src/proxy.ts`,
  where it runs before rendering and can still answer 404. That means verifying
  the signed session in the proxy runtime — a real change to the auth surface,
  and not one to make in passing. Until then, dynamic rendering is the honest
  trade: no data leaked in the attempt (checked — the only admin-ish strings in
  the anonymous response were the i18n dictionary blob that ships on every
  page), but a 200 where a 404 belongs is a weakened security posture and an
  SEO regression, and neither is worth a first-paint improvement on a site with
  no traffic problem.

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

## 2026-09-07 — P2-16 probe: how much history the DNSE feed actually serves

- **Why it matters:** the roadmap requires "honest caps per feed (probe + document)" before load-more
  ships, so the chart stops asking at a real limit rather than looping on an empty window.
- **Method:** direct windowed requests to
  `services.entrade.com.vn/chart-api/v2/ohlcs/stock?from=&to=&resolution=`, varying the window and
  the resolution. Run 2026-09-07.
- **Daily and above — floor 2012-03-20.** Asking twenty years back returns 3,609 bars beginning
  exactly 2012-03-20. FPT, HPG and VCB all start on that same date, which makes it the FEED's floor
  rather than any listing date. Symbols listed later start later (ACV: 2016-11-21). A window wholly
  older than the floor returns zero bars rather than an error, which is what the client's
  "stop asking" latch keys on.
- **Intraday — about 90 days, at every resolution.** A 120-to-90-day window returns bars; a
  200-to-150-day window returns none. 1m asked for 30 days and 15m asked for 365 both stop at the
  same calendar date, so the limit is the feed's RETENTION, not the resolution.
- **Windowed requests into the past work**, which is what makes load-more possible at all:
  `from`/`to` entirely in the past return exactly that window (~250 daily bars per year requested).
- **Recorded in code** at `packages/core/src/chart/history-window.ts` as `DAILY_FLOOR_ISO` and
  `INTRADAY_FLOOR_DAYS`, with a unit test asserting the constants match what was probed, so a future
  re-probe has something to compare against.
- **Status:** SHIPPED 2026-09-07 as P2-16.

## 2026-09-07 — ROOT CAUSE of the migration blocker: the connection string is an unfilled template

- **Where:** `DATABASE_URL` and `MIGRATE_DATABASE_URL` in `.env.local`, and almost certainly the
  same values in Vercel — this has blocked migrations 006, 007 and now 008 since 2026-09-06.
- **Symptom:** `new URL(value)` throws `ERR_INVALID_URL`, so `scripts/db-migrate.mjs` skips (by
  design, exiting 0 rather than failing the build) and every database-backed feature is dark:
  cross-device sync, saved layouts, alert provenance, and now recorded gold history.
- **Cause, found by inspecting the string's SHAPE rather than its contents:**

      postgres://postgres.<ref>:<pw>@aws-0-<region>.pooler.supabase.com:5432/postgres

  The angle brackets are LITERAL. It is Supabase's copy-paste template with `<ref>`, `<pw>` and
  `<region>` never substituted. `<` and `>` are not legal in a URL's userinfo or host, which is
  exactly why it fails to parse while looking plausible at a glance — it has the right scheme, one
  `@`, no spaces, and the right length.
- **Fix (a human must do this, the values are secrets):** in the Supabase dashboard take
  Settings → Database → Connection string → **Session mode** (port 5432, NOT 6543 transaction
  mode, which cannot run DDL), and paste the real value — replacing every `<…>` placeholder,
  including the password — into both `.env.local` and the Vercel project's environment. Then
  redeploy so `db:migrate` runs 006, 007 and 008.
- **Verify afterwards:** `node -e 'new URL(process.env.DATABASE_URL)'` exits silently, and
  `/api/bars?symbol=GOLD:SJC` returns 200 instead of 501.
- **Confirmed in production 2026-09-08**, from the deploy log rather than by inference:
  `db:migrate — skipped: MIGRATE_DATABASE_URL is not a valid Postgres URL.` So the production
  value is broken too, not only the local one.
- **A note on how NOT to check this.** `vercel env pull` returns the literal string `[encrypted]`
  for Secret-type variables. Validating what it writes reports "does not parse" for a connection
  string that may be perfectly fine — a false positive that looks like evidence. The deploy log is
  the reliable signal; the pulled file is not.
- **`npm run db:check`** (added 2026-09-08) reports which of the usual mistakes was made, without
  ever printing the value: unreplaced `<placeholder>` or `[YOUR-PASSWORD]`, surrounding quotes,
  whitespace, the `:6543` transaction pooler, and an unencoded `@` in the password — which is the
  nastiest of them, because `new URL` splits on the LAST `@`, so it parses cleanly and then
  authenticates as the wrong user. When the format is good it connects for real and lists pending
  migrations, because a string that parses is not the same as credentials that work. It also names
  the SOURCE of each value, because the precedence is itself a trap: an `export` in one terminal
  makes the check pass while `.env.local` stays broken and nothing persists, so the check goes
  green and another terminal, a fresh build and the deploy all still fail. That exact confusion
  happened on 2026-09-08 and cost a round trip.
- **`npm run db:url`** (added 2026-09-08) writes both strings from a password read with echo off:
  never printed, never passed as an argument (which would put it in `ps` and shell history), and
  percent-encoded so an `@ # / : ?` in it cannot break the URL. It writes TWO strings on purpose —
  `DATABASE_URL` on `:6543` (transaction pooler, right for serverless request handling) and
  `MIGRATE_DATABASE_URL` on `:5432` (session mode). The same Supabase pooler host serves both
  ports; only the port differs.
- **RESOLVED 2026-09-08.** Connected, all 8 migrations applied, schema up to date. Running the
  postgres half of the driver contract for the FIRST time — it had never been run against a real
  database — found three defects that the file driver could not:
  1. **jsonb came back as a STRING** from `docs.put/get/list`. `/api/docs` would have answered with
     a JSON string where every caller expects an object, so `parseLayouts` and `parseDrawings`
     would take it for a malformed document and return nothing: cross-device sync and saved
     layouts restoring as empty, silently. Normalised in `toDoc`.
  2. **The contract suite was not re-runnable.** Its own header claimed fixtures were safe against
     a database that is not truncated; the suffix was per-test, not per-RUN, so a second run reused
     every email and token hash. Postgres has a primary key on `token_hash` and failed; the file
     driver has no such constraint and silently kept both. Now suffixed with the run.
  3. **`orders.recent` is global by design** (it backs the owner's ledger), so accumulated rows
     crowded a test's own out of its window. Its fixtures now use real timestamps.
- **Status:** RESOLVED locally; Vercel still needs the same two values, and a redeploy. Host, port, database and user
  were supplied 2026-09-08 (`aws-0-ap-southeast-1.pooler.supabase.com`, user `postgres.<ref>`),
  and the host resolves with both ports open. Everything on the code side is shipped and tested
  against the file driver.


## 2026-09-08 — an empty NEXT_PUBLIC_SITE_URL had silently disabled three features

- **Found while checking CRON_SECRET.** Every cron endpoint answered 401 (gated, secret present)
  except `/api/cron/teaser`, which answered 501. That route additionally requires
  `NEXT_PUBLIC_SITE_URL`, and it was empty in production.
- **Blast radius.** Three features gate on that variable, and all three were off on the live site
  while every page rendered normally: the weekly teaser (501), billing checkout (501), and
  **sign-in** — `/vi/dang-nhap` showed "chua duoc kich hoat", because `deliverable()` requires
  `linkOrigin() !== null`.
- **Fixed by configuration**, not code: `NEXT_PUBLIC_SITE_URL` is now set to the live origin in
  Production and Preview. The teaser cron went 501 to 401.
- **A code fix was written and then REVERTED**, and the reason is worth keeping. Routing
  `linkOrigin()` through `siteUrl()` — which falls back to the production origin — would have fixed
  all three at once, and a test refused it: "A guessed default mails a live bearer token to
  whichever deployment owns that domain, which a fork or a preview does not." That is right. A fork
  with no site URL would email sign-in links pointing at production. The existing behaviour is
  deliberate; the configuration was the fault.
- **Sign-in is still off**, for a different reason. In production `activeAuthProvider()` returns
  `disabled` unless `AUTH_PROVIDER` is exactly `magic`, and `activeMailDriver()` returns `none`
  unless `MAIL_PROVIDER` is `resend` or `console`. Both variables exist but are Secret-typed, so
  their values cannot be read back. Setting `MAIL_PROVIDER=resend` without a working
  `RESEND_API_KEY` would turn an honest "not activated" into silent send failures, which is worse.
- **Status:** OPEN — needs the owner to confirm `AUTH_PROVIDER=magic` and that the Resend key is
  live, then set `MAIL_PROVIDER=resend`.
