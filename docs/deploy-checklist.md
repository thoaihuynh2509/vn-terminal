# Production deploy checklist

Target: Vercel + Supabase Postgres. Work top to bottom; each step says how to
verify it. The app is **fail-closed** — every unconfigured integration degrades
to a safe state (usually a 501 or a "coming soon"), so a partial launch is safe:
ship the board first, switch on payments and email when the accounts are ready.

Nothing here can be done for you — it needs your accounts and secret keys. Set
every secret in **Vercel → Project → Settings → Environment Variables**
(Production), never commit them. `.env.example` is the full, annotated list.

---

## 0. Pre-flight (local, once)
- [ ] `npm run verify` is green (typecheck + lint + 985 unit tests + build).
- [ ] `npm run test:a11y` passes (needs the app running; 15 pages, `bodyOverflowX=false`).
- [ ] Decide prices in `src/lib/billing/plans.ts` (→ `packages/core/src/billing/plans.ts`).
- [ ] Decide the product NAME. It lives in exactly one file,
      `packages/core/src/brand.ts` — `BRAND.name`, `BRAND.slug` and the two
      taglines. A test (`brand.test.ts`) fails the build if a literal creeps
      back into any other source file, so the rename stays one edit forever.

## 1. Core (required — the site serves without these, but signed-in features 501)
- [ ] **`AUTH_SECRET`** — `openssl rand -hex 32`. Without it, sessions are off and
      everyone is anonymous (site still serves). Also required for the free-AI
      teaser counter.
- [ ] **`NEXT_PUBLIC_SITE_URL`** — your real origin, e.g. `https://cophieuviet.vn`.
      Drives magic-link, every payment return/IPN URL, **and every canonical,
      hreflang and sitemap entry**. A wrong value mails live tokens to a domain
      you may not own → magic-link answers 501.
      Set it and the old `*.vercel.app` host starts 308-ing to the domain in
      production (`canonicalRedirect`, `packages/core/src/routing.ts`), so the
      two origins stop competing for the same pages. Preview deploys are
      exempt, and with the variable unset nothing redirects.
- [ ] **`GOOGLE_SITE_VERIFICATION`** (optional but do it) — the content value of
      Search Console's meta-tag method. Unset renders no tag, which is correct
      before you own the property.
- [ ] **`AUTH_PROVIDER=magic`** — the real provider. `dev` refuses to run in
      production; leaving it unset in prod means sign-in is disabled.

## 2. Database (Supabase) — see `docs/database-setup.md`
- [ ] Create a Supabase project (region: Singapore).
- [ ] **`DATABASE_URL`** = the **Transaction pooler** string (host `…pooler…`, :6543).
- [ ] **`MIGRATE_DATABASE_URL`** = the **direct/session** string (:5432) — advisory
      locks need a session connection, the pooler can't hold them.
- [ ] Migrations run automatically on deploy: `vercel.json` sets
      `buildCommand: "npm run db:migrate && next build"` (applies `001`–`010`,
      idempotent; a no-op that exits 0 when no DB URL is set, so previews still
      build). It reads `MIGRATE_DATABASE_URL` (the session :5432 URL) — make sure
      that env var is set in Vercel, or the build-time migrate falls back to the
      pooler and its advisory lock will not hold.
- [ ] Verify: re-run migrate → "up to date"; the tables `users, orders,
      magic_tokens, watchlist_items, alerts, series_points, briefs,
      schema_migrations` exist.
- [ ] `briefs` (migration `010`) is what makes `/ban-tin/<date>` exist. Until it
      is applied every dated URL 404s and the archive index hides itself — the
      site still serves, it simply publishes nothing.

## 3. Email (Resend) — required for magic-link sign-in and retention mail
- [ ] **`MAIL_PROVIDER=resend`**, **`RESEND_API_KEY`**, **`MAIL_FROM`** (a verified
      Resend sender, e.g. `Cổ Phiếu Việt <no-reply@cophieuviet.vn>`). Unset, the
      sender falls back to Resend's shared onboarding address under the
      configured brand name (`mailFrom()`, `packages/core/src/brand.ts`).
- [ ] Verify a magic link sends (sign in with your own email). Without a mailer,
      `AUTH_PROVIDER=magic` requests answer 501 rather than logging a token.

## 4. Payments (turn on at least one; each is independent and fail-closed)
- [ ] **MoMo** — `MOMO_PARTNER_CODE`, `MOMO_ACCESS_KEY`, `MOMO_SECRET_KEY` from the
      MoMo merchant dashboard; set `MOMO_ENDPOINT` to the **production** create URL
      (defaults to sandbox). IPN URL to register: `${SITE}/api/billing/momo/ipn`.
- [ ] **VNPay** (optional) — `VNPAY_TMN_CODE`, `VNPAY_HASH_SECRET`; set
      `VNPAY_PAY_URL` to production (defaults to sandbox). IPN: `${SITE}/api/billing/vnpay/ipn`.
- [ ] **SePay** (optional, cheapest) — `SEPAY_API_KEY`, `SEPAY_BANK`, `SEPAY_ACCOUNT`;
      register the webhook `${SITE}/api/billing/sepay/webhook` with the API key in SePay.
- [ ] Verify (sandbox first): sign in → pricing → upgrade → complete a payment →
      the provider's IPN/webhook flips the order and grants the tier; the pricing
      page shows "Đã kích hoạt". Unconfigured providers simply don't appear.

## 5. Scheduled jobs (Vercel Cron) — retention
- [ ] **`CRON_SECRET`** — `openssl rand -hex 32`. Vercel sends it as the cron Bearer;
      without it the cron routes answer 501 (never open).
- [ ] Confirm `vercel.json` crons are present: `/api/cron/alerts`, `/api/cron/brief`,
      `/api/cron/renewals`, `/api/cron/teaser`. Times are **UTC**.
- [ ] `/api/cron/brief` now does two jobs: it archives the day's brief as a
      permanent page **and** emails subscribers. The archive is written first
      and unconditionally, so it still runs with zero subscribers and no
      mailer — which is exactly the state a new site launches in. A day the
      cron misses simply has no page; nothing backfills it.
- [ ] **Vercel plan note**: Hobby (free) allows each cron **at most once per day**.
      `vercel.json` is set to comply — price alerts run once, at 15:30 ICT (after
      close). For **15-minute** alerting either upgrade to **Pro** and change the
      alerts schedule back to `*/15 2-8 * * 1-5`, or keep Hobby and hit
      `/api/cron/alerts` from an **external scheduler** (cron-job.org, GitHub
      Actions…) every 15 min with header `Authorization: Bearer $CRON_SECRET`.
- [ ] Verify after deploy: `curl -H "Authorization: Bearer $CRON_SECRET"
      $SITE/api/cron/renewals` → `{ok:true,...}`; no header → 401; no secret → 501.

## 6. Admin & AI (optional)
- [ ] **`ADMIN_EMAILS`** = your sign-in email(s), comma-separated → unlocks
      `/:locale/admin` (order reconciliation). Everyone else gets 404.
- [ ] **AI**: leave `ASK_PROVIDER=mock` to ship the assistant free (composes from
      real page data, no key). To use the real model set `ASK_PROVIDER=claude` +
      `ANTHROPIC_API_KEY`; it stays gated (Plus+, 2 free asks) and rate-limited.
- [ ] `NEXT_PUBLIC_USD_VND` — reference rate for the gold premium (default 26300).

## 7. Go-live
- [ ] Point the domain at Vercel; confirm `NEXT_PUBLIC_SITE_URL` matches it exactly.
- [ ] Smoke test on the live URL: `/vi` renders; sign in via magic link; upgrade a
      test account end-to-end; open `/vi/admin` as an admin; `robots.txt` +
      `sitemap.xml` resolve.
- [ ] `curl -I https://<old>.vercel.app/vi` → **308** to the domain.
- [ ] **Google Search Console**: add the property, verify (the meta tag above),
      submit `/sitemap.xml`. Then watch Coverage and Query weekly — without it
      you are optimising blind. See `docs/seo-plan.md`.
- [ ] After the first weekday close, confirm `/vi/ban-tin/<that date>` renders
      and appears in `sitemap.xml`. That is the publishing engine working.
- [ ] Follow-up (post-launch): once cron + mailer are live, update the in-app
      `AlertPanel` scope note (and its test) to reflect that alerts now reach
      subscribers by email — see `docs/specs/monetization.md`.

## Fail-closed reference (what a missing key does)
| Missing | Effect |
|---|---|
| `AUTH_SECRET` | sessions off, everyone anonymous; site serves |
| `DATABASE_URL` | auth + watchlist + billing 501; site serves |
| `MAIL_PROVIDER`/key | magic-link 501; retention mail skipped |
| a payment provider | that method hidden; pricing shows "coming soon" if none |
| `CRON_SECRET` | cron routes 501 |
| `ADMIN_EMAILS` | `/admin` 404 for everyone |
| `ASK_PROVIDER`/key | assistant runs in mock mode |
| `GOOGLE_SITE_VERIFICATION` | no verification meta tag; everything else unaffected |
| `briefs` table absent | dated briefs 404, archive index hidden; live brief serves |
