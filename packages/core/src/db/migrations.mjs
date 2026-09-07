/**
 * The schema, as an ordered list of migrations.
 *
 * Append only, and never edit an id or the SQL of a migration that has shipped:
 * `schema_migrations` records what ran, so a rewritten migration is a database
 * that disagrees with the code and can never be reconciled.
 *
 * `schema_migrations` itself is created by the runner, not by a migration —
 * the ledger has to exist before anything can be recorded in it.
 */
export const MIGRATIONS = [
  {
    id: "001_init",
    sql: `
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE CHECK (email = lower(email) AND length(email) <= 254),
  tier text NOT NULL DEFAULT 'free' CHECK (tier IN ('free','plus','pro')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE magic_tokens (
  token_hash text PRIMARY KEY,          -- hex SHA-256; raw token NEVER stored
  email text NOT NULL CHECK (email = lower(email)),
  redirect_to text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz
);
CREATE INDEX magic_tokens_email_created_idx ON magic_tokens (email, created_at DESC);
CREATE INDEX magic_tokens_expires_idx ON magic_tokens (expires_at);
CREATE TABLE watchlist_items (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol text NOT NULL CHECK (symbol ~ '^[A-Z0-9]{1,10}$'),
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, symbol)   -- the no-duplicates guarantee lives HERE, not in app code
);
CREATE TABLE alerts (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id text NOT NULL, symbol text NOT NULL CHECK (symbol ~ '^[A-Z0-9]{1,10}$'),
  condition text NOT NULL CHECK (condition IN ('above','below','cross_up','cross_down')),
  price double precision NOT NULL CHECK (price > 0),
  created_at timestamptz NOT NULL, triggered_at timestamptz,
  PRIMARY KEY (user_id, id)
);
CREATE INDEX alerts_user_symbol_idx ON alerts (user_id, symbol);
`,
  },
  {
    id: "002_subscriptions",
    sql: `
ALTER TABLE users ADD COLUMN tier_expires_at timestamptz;
CREATE TABLE orders (
  id text PRIMARY KEY,                  -- our order id, also sent to the provider
  email text NOT NULL CHECK (email = lower(email)),
  tier text NOT NULL CHECK (tier IN ('plus','pro')),
  plan text NOT NULL CHECK (plan IN ('monthly','annual')),
  amount integer NOT NULL CHECK (amount > 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','failed')),
  provider text NOT NULL,
  provider_ref text,                    -- provider transaction id, set on payment
  created_at timestamptz NOT NULL,
  paid_at timestamptz
);
CREATE INDEX orders_email_created_idx ON orders (email, created_at DESC);
`,
  },
  {
    id: "003_renewal_reminders",
    sql: `
ALTER TABLE users ADD COLUMN renewal_reminded_at timestamptz;
CREATE INDEX orders_created_idx ON orders (created_at DESC);
`,
  },
  {
    id: "004_referrals",
    sql: `
ALTER TABLE users ADD COLUMN referral_code text;
ALTER TABLE users ADD COLUMN referred_by text;
ALTER TABLE users ADD COLUMN referral_rewarded_at timestamptz;
UPDATE users SET referral_code = upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))
  WHERE referral_code IS NULL;
ALTER TABLE users ALTER COLUMN referral_code SET NOT NULL;
CREATE UNIQUE INDEX users_referral_code_idx ON users (referral_code);
`,
  },
  {
    id: "005_marketing",
    sql: `
ALTER TABLE users ADD COLUMN marketing_opt_out boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN teaser_sent_at timestamptz;
`,
  },
  {
    // One table for every saved chart artifact — drawings, layouts, indicator
    // templates, chart settings — rather than four near-identical tables. They
    // share a shape (a small per-user JSON blob addressed by a name) and a
    // lifecycle, so they share storage; `kind` keeps them apart and lets a new
    // artifact type ship without a migration.
    //
    // `version` is the optimistic-concurrency counter the sync uses to decide a
    // last-write-wins conflict between two devices. `data` is jsonb so a future
    // query can reach inside it; the app treats it as opaque.
    id: "006_user_docs",
    sql: `
CREATE TABLE user_docs (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind ~ '^[a-z][a-z0-9_]{0,31}$'),
  key text NOT NULL CHECK (length(key) BETWEEN 1 AND 64),
  data jsonb NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, kind, key)
);
CREATE INDEX user_docs_user_kind_idx ON user_docs (user_id, kind);
`,
  },
  {
    // Alert kinds. `price` stays the threshold for all of them — a percent alert
    // resolves to a fixed level when it is created, and an indicator alert's
    // level (RSI 70) is just as much a threshold — so the existing column and
    // its `> 0` check still hold and no row needs rewriting. The extra columns
    // are provenance: what the reader actually asked for, so the UI can say
    // "+5% (65.10)" rather than a bare number they never typed.
    id: "007_alert_kinds",
    sql: `
ALTER TABLE alerts ADD COLUMN kind text NOT NULL DEFAULT 'price'
  CHECK (kind IN ('price','pct','indicator'));
ALTER TABLE alerts ADD COLUMN pct double precision;
ALTER TABLE alerts ADD COLUMN base_price double precision;
ALTER TABLE alerts ADD COLUMN indicator text;
ALTER TABLE alerts ADD COLUMN period integer CHECK (period IS NULL OR (period >= 2 AND period <= 200));
`,
  },
];
