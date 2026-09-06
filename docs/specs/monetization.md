# Monetization & retention

Goal: turn VN Terminal into a recurring income source — readers subscribe to a
paid tier (VIP) and keep coming back. Payment provider chosen: **MoMo**. Prices
are **monthly + annual**, editable in one file (`src/lib/billing/plans.ts`).

The product is already tier-aware: `entitlement.ts` names every capability and
which tier grants it, the paywall is enforced server-side, and tier is a signed
property of the account. What was missing is (1) a way to actually pay and get
upgraded, and (2) recurring reasons to return.

## Phase 1 — Income engine (this build)

- **Prices** — `plans.ts`: Plus 99k/mo · 990k/yr, Pro 199k/mo · 1.990k/yr.
  Monthly = 30 days of access, annual = 365. Change the numbers here only.
- **Subscription = tier + expiry.** The session cookie already carries the
  tier; it now also carries `exp` (subscription end, unix seconds). `decodeSession`
  downgrades an expired session to `free` at the single chokepoint every reader
  already goes through — no per-request DB read, no call-site changes. The DB is
  the source of truth for renewals; the cookie is a self-expiring snapshot.
- **Orders ledger.** Each purchase is a row (`pending → paid`), so a duplicate
  IPN grants exactly once and every payment is reconcilable.
- **MoMo AIO** (`momo.ts`): pure signature build + verify, unit-tested against a
  fixed vector. `captureWallet` one-time payment; the IPN (server-to-server) is
  the only thing that grants — the browser redirect is never trusted for money.
- **Routes:** `POST /api/billing/checkout` (auth'd, creates the pending order,
  returns MoMo `payUrl`), `POST /api/billing/momo/ipn` (verifies, marks paid,
  grants tier+expiry — idempotent), `POST /api/auth/refresh` (re-mints the cookie
  from the DB row so an upgrade shows immediately without re-login).
- **Pricing page** becomes a real store: monthly/annual toggle, annual-saving
  badge, a working upgrade CTA (signed-out → sign in first), and a return page
  that polls the order until the IPN lands.

### Go-live checklist (needs the owner)
MoMo is spec-correct and runs against the sandbox with these set; production
needs a real MoMo merchant account. Env: `MOMO_PARTNER_CODE`, `MOMO_ACCESS_KEY`,
`MOMO_SECRET_KEY`, `MOMO_ENDPOINT` (defaults to sandbox), plus the existing
`NEXT_PUBLIC_SITE_URL`, `AUTH_SECRET`, and a real `DATABASE_URL`. Without the
MoMo vars, checkout answers 501 and the pricing page shows "coming soon" — the
same fail-closed pattern as auth.

## Phase 2 — Retention (built)

- **Server-delivered price alerts** — `/api/cron/alerts` runs the pure
  `runUserAlerts` (built on `shouldFire`) against the latest board and emails a
  subscriber when an alert fires, even with the tab closed. Only readers whose
  CURRENT entitlement includes alerts are evaluated (`effectiveTier` applies the
  expiry downgrade), the one-shot flag is persisted before the mail, so a re-run
  never double-sends. Vercel Cron every 15 min during market hours.
- **Daily brief email** — `/api/cron/brief` composes `buildBrief` from the day's
  feeds and mails it to current subscribers (Plus+). Vercel Cron after close.
- Both cron routes are gated by `CRON_SECRET` (Bearer) and fail closed (501)
  when it or the DB is unset; delivery uses the shared `sendEmail`, which is a
  no-op returning false when no `MAIL_PROVIDER` is configured.

### Go-live for retention
Set `CRON_SECRET` (Vercel injects it as the cron Bearer) and configure the
mailer (`MAIL_PROVIDER=resend` + `RESEND_API_KEY` + `MAIL_FROM`). Schedules are
in `vercel.json` (times are UTC; market hours 09:00–15:00 ICT = 02:00–08:00 UTC).

### Follow-up
The in-app `AlertPanel` scope note (and its pinning test) still says alerts fire
only in an open tab — true until cron+mailer are live. Once retention is
configured in production, update that copy to reflect email delivery for Plus+,
and update its test with it.

- **Weekly free teaser** (not built) to signed-out readers who once signed in,
  linking the paid surface — earns the upgrade rather than nagging. Needs a
  consent/unsubscribe flow first.

## Phase 3 — Growth

Built:

- **Renewal reminder** — `/api/cron/renewals` mails a subscriber once in the
  final 7 days before `tierExpiresAt`. The `renewalRemindedAt` mark (cleared by
  every `grant`, set only after the mail sends) makes it once-per-term, never
  daily. Daily Vercel Cron; same `CRON_SECRET` gate.
- **Admin reconciliation** — `/:locale/admin` shows revenue, paid/pending counts
  and recent orders from the ledger. Owner-only via the `ADMIN_EMAILS` allowlist
  matched on the signed session email; a non-admin gets a 404, never a 403.

- **More payment providers** — the checkout now dispatches on a `provider`
  param over `enabledProviders()`. **VNPay** (redirect, HMAC-SHA512 secure hash)
  and **SePay** (bank-transfer QR; the memo is the order id, a webhook settles
  it) join MoMo behind the SAME order→grant flow. `grantForOrder` in `settle.ts`
  is the one place a paid order becomes entitlement. The pricing page shows a
  method picker over whatever is configured; unconfigured providers never appear.
- **Referral** — every account has a public `referralCode`; a `?ref=` at landing
  is captured by the proxy into a cookie and attributed at signup (set-once, no
  self-referral). A referred reader's FIRST paid order credits the referrer a
  free month, once (guarded by `referralRewardedAt`). Shareable link on the
  pricing page.
- **Weekly teaser** — `/api/cron/teaser` nudges signed-up FREE readers toward a
  plan, weekly, never paid readers. Consent-respecting: a `marketing_opt_out`
  flag, a `teaser_sent_at` throttle, and a login-free one-click unsubscribe
  (`/api/unsubscribe`, authorised by an HMAC token, safe as a GET).

### Go-live for the extra providers
VNPay: `VNPAY_TMN_CODE`, `VNPAY_HASH_SECRET` (sandbox has its own), IPN URL
`/api/billing/vnpay/ipn`. SePay: `SEPAY_API_KEY`, `SEPAY_BANK`, `SEPAY_ACCOUNT`,
webhook `/api/billing/sepay/webhook`. Referral reward days:
`src/lib/billing/referral.ts`. Teaser needs `CRON_SECRET` + mailer + site URL.

Not built:

- Admin controls beyond read-only reconciliation (refunds, manual grants).
