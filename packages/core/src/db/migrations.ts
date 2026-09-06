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
export const MIGRATIONS: readonly { id: string; sql: string }[] = [
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
];
