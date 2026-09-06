# Database setup (Supabase)

The app runs with **no database** (auth + watchlist sync answer 501, the site
still serves). To turn on accounts, subscriptions, referrals and retention you
need a Postgres. These steps use **Supabase**; any Postgres works.

The driver auto-selects: set `DATABASE_URL` and the code uses the postgres
driver; unset, it uses the local file driver in dev and "none" in production.

## 1. Create the database
1. Create a project at supabase.com. Pick a region close to Vietnam (Singapore).
2. Project → **Connect** → **Connection string**. Supabase gives you two shapes:
   - **Transaction pooler** (host `...pooler.supabase.com`, port **6543**) — for
     the app at runtime. Serverless opens many short connections; the pooler is
     what survives that. The driver already sets `prepare: false`, which this
     mode **requires**.
   - **Direct / session** (port **5432**) — for running migrations. Migrations
     take a session advisory lock, which the transaction pooler does not hold.

## 2. Set the connection strings
Local (`.env.local`):
```
DATABASE_URL=postgres://postgres.<ref>:<pw>@aws-0-<region>.pooler.supabase.com:6543/postgres
MIGRATE_DATABASE_URL=postgres://postgres.<ref>:<pw>@aws-0-<region>.pooler.supabase.com:5432/postgres
```
On Vercel, set the same two in Project → Settings → Environment Variables.
`MIGRATE_DATABASE_URL` falls back to `DATABASE_URL` if you only set one (fine
locally where they're the same host).

## 3. Apply the schema
```
npm run db:migrate
```
Idempotent and safe to run on every deploy — it applies only what the ledger
(`schema_migrations`) has not recorded, under an advisory lock so two deploys
cannot race, each migration in its own transaction. Add it to your deploy step.

## 4. Verify (optional, needs a throwaway DB)
Run the full driver contract against real Postgres:
```
TEST_DATABASE_URL=postgres://.../postgres_test npm run test:unit
```
Use a SEPARATE database — the suite writes test rows. All 108 driver checks
(both file and postgres) must pass.

## What each migration adds
`001` accounts, magic tokens, watchlist, alerts · `002` subscriptions (tier
expiry) + orders ledger · `003` renewal reminders · `004` referrals · `005`
marketing opt-out. Migrations are append-only; never edit one that has shipped.

## Also required for the paid product
`AUTH_SECRET` (sessions), `NEXT_PUBLIC_SITE_URL` (magic links, payment returns),
a mailer (`MAIL_PROVIDER=resend` + `RESEND_API_KEY` + `MAIL_FROM`), `CRON_SECRET`
(retention crons), a payment provider (`MOMO_*` / `VNPAY_*` / `SEPAY_*`), and
`ADMIN_EMAILS` for `/:locale/admin`. See `.env.example`.
