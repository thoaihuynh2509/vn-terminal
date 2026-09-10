/**
 * Postgres driver (postgres.js).
 *
 * `prepare: false` is required, not a preference: Supabase/pgbouncer in
 * transaction pooling mode does not keep a session for prepared statements.
 *
 * The client is a `globalThis` singleton because `next dev` re-evaluates
 * modules on hot reload — a module-level `const` would leak a connection pool
 * per reload until the database refuses new connections.
 */
import postgres from "postgres";
import type { PriceAlert } from "../alerts/alerts.ts";
import type { Db, DocRecord, NewMagicToken, NewOrder, OrderRecord, OrderStatus, StoredTier, UserRecord } from "./types.ts";
import { newReferralCode, normalizeCode } from "../billing/referral.ts";

interface UserRow {
  id: string;
  email: string;
  tier: StoredTier;
  tier_expires_at: Date | null;
  renewal_reminded_at: Date | null;
  referral_code: string;
  referred_by: string | null;
  referral_rewarded_at: Date | null;
  marketing_opt_out: boolean;
  teaser_sent_at: Date | null;
  created_at: Date;
}

interface OrderRow {
  id: string;
  email: string;
  tier: "plus" | "pro";
  plan: "monthly" | "annual";
  amount: number;
  status: OrderStatus;
  provider: string;
  provider_ref: string | null;
  created_at: Date;
  paid_at: Date | null;
  revoked_at: Date | null;
}

interface AlertRow {
  id: string;
  symbol: string;
  condition: PriceAlert["condition"];
  price: number;
  created_at: Date;
  triggered_at: Date | null;
  kind: string;
  pct: number | null;
  base_price: number | null;
  indicator: string | null;
  period: number | null;
}

interface DocRow {
  kind: string;
  key: string;
  data: unknown;
  version: number;
  updated_at: Date;
}

type PgGlobal = typeof globalThis & { __vnt_pg?: { url: string; sql: postgres.Sql } };

export function pgClient(url: string): postgres.Sql {
  const g = globalThis as PgGlobal;
  if (!g.__vnt_pg || g.__vnt_pg.url !== url) {
    g.__vnt_pg = {
      url,
      sql: postgres(url, { prepare: false, max: 5, idle_timeout: 20, connect_timeout: 10 }),
    };
  }
  return g.__vnt_pg.sql;
}

const toUser = (r: UserRow): UserRecord => ({
  id: r.id,
  email: r.email,
  tier: r.tier,
  tierExpiresAt: r.tier_expires_at ?? null,
  renewalRemindedAt: r.renewal_reminded_at ?? null,
  referralCode: r.referral_code,
  referredBy: r.referred_by ?? null,
  referralRewardedAt: r.referral_rewarded_at ?? null,
  marketingOptOut: !!r.marketing_opt_out,
  teaserSentAt: r.teaser_sent_at ?? null,
  createdAt: r.created_at,
});

const toOrder = (r: OrderRow): OrderRecord => ({
  id: r.id,
  email: r.email,
  tier: r.tier,
  plan: r.plan,
  amount: r.amount,
  status: r.status,
  provider: r.provider,
  providerRef: r.provider_ref,
  createdAt: r.created_at,
  paidAt: r.paid_at,
  revokedAt: r.revoked_at,
});

const toAlert = (r: AlertRow): PriceAlert => ({
  id: r.id,
  symbol: r.symbol,
  condition: r.condition,
  price: r.price,
  createdAt: r.created_at.getTime(),
  ...(r.triggered_at ? { triggeredAt: r.triggered_at.getTime() } : {}),
  // `price` is the default kind, so it is left off the object entirely — the
  // shape then matches what the browser stores for a plain price alert.
  ...(r.kind && r.kind !== "price" ? { kind: r.kind as PriceAlert["kind"] } : {}),
  ...(r.pct !== null ? { pct: r.pct } : {}),
  ...(r.base_price !== null ? { basePrice: r.base_price } : {}),
  ...(r.indicator ? { indicator: r.indicator as PriceAlert["indicator"] } : {}),
  ...(r.period !== null ? { period: r.period } : {}),
});

/**
 * A `jsonb` column does not always arrive parsed.
 *
 * The column IS jsonb and `pg_typeof` confirms it, but this driver hands the
 * value back as a STRING — with `prepare` either way, so it is not the pooler
 * setting. The file driver returns an object, so nothing caught it: every unit
 * test runs on the file driver, and the postgres half of the contract suite had
 * never been run against a real database.
 *
 * That divergence is not cosmetic. `/api/docs` would have answered with a JSON
 * string where every caller expects an object, so `parseLayouts` and
 * `parseDrawings` would take it for a malformed document and quietly return
 * nothing — cross-device sync and saved layouts restoring as empty, with no
 * error anywhere.
 *
 * Normalised here rather than by configuring the driver, so it is correct
 * whichever way the library behaves and cannot regress if that changes.
 */
function parseDocData(v: unknown): unknown {
  if (typeof v !== "string") return v;
  try {
    return JSON.parse(v);
  } catch {
    // Not JSON at all: hand back what is stored rather than inventing a shape.
    return v;
  }
}

const toDoc = (r: DocRow): DocRecord => ({
  kind: r.kind,
  key: r.key,
  data: parseDocData(r.data),
  version: r.version,
  updatedAt: r.updated_at,
});

export async function createPostgresDb(url: string): Promise<Db> {
  const sql = pgClient(url);

  return {
    users: {
      async all() {
        const rows = await sql<UserRow[]>`
          SELECT id, email, tier, tier_expires_at, renewal_reminded_at, referral_code, referred_by, referral_rewarded_at, marketing_opt_out, teaser_sent_at, created_at FROM users ORDER BY created_at`;
        return rows.map(toUser);
      },

      async findByEmail(email) {
        const rows = await sql<UserRow[]>`
          SELECT id, email, tier, tier_expires_at, renewal_reminded_at, referral_code, referred_by, referral_rewarded_at, marketing_opt_out, teaser_sent_at, created_at FROM users WHERE email = ${email.toLowerCase()}`;
        return rows[0] ? toUser(rows[0]) : null;
      },

      async upsertByEmail(email) {
        // DO UPDATE rather than DO NOTHING so the row comes back either way,
        // and it touches only email so an existing tier is never reset.
        // `xmax = 0` is the ON CONFLICT implementation detail that tells the two
        // apart: an inserted row has no updating transaction stamped on it, an
        // upserted one does. There is no other way to ask which branch ran.
        const rows = await sql<(UserRow & { created: boolean })[]>`
          INSERT INTO users (email, referral_code) VALUES (${email.toLowerCase()}, ${newReferralCode()})
          ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
          RETURNING id, email, tier, tier_expires_at, renewal_reminded_at, referral_code, referred_by, referral_rewarded_at, marketing_opt_out, teaser_sent_at, created_at, (xmax = 0) AS created`;
        return { ...toUser(rows[0]), created: rows[0].created };
      },

      async setTier(email, tier) {
        // A move to free drops any dangling expiry; otherwise expiry is left as is.
        const rows = await sql<UserRow[]>`
          UPDATE users
             SET tier = ${tier},
                 tier_expires_at = CASE WHEN ${tier} = 'free' THEN NULL ELSE tier_expires_at END
           WHERE email = ${email.toLowerCase()}
          RETURNING id, email, tier, tier_expires_at, renewal_reminded_at, referral_code, referred_by, referral_rewarded_at, marketing_opt_out, teaser_sent_at, created_at`;
        return rows[0] ? toUser(rows[0]) : null;
      },

      async grant(email, tier, expiresAt) {
        // Extend from the later of now and a live subscription of the SAME tier,
        // so a renewal stacks time; a tier change starts fresh from now. The
        // added term is (expiresAt - now); one atomic UPDATE computes the new end.
        const rows = await sql<UserRow[]>`
          UPDATE users
             SET tier = ${tier},
                 renewal_reminded_at = NULL,
                 tier_expires_at = GREATEST(
                   now(),
                   CASE WHEN tier = ${tier} THEN COALESCE(tier_expires_at, now()) ELSE now() END
                 ) + (${expiresAt.toISOString()}::timestamptz - now())
           WHERE email = ${email.toLowerCase()}
          RETURNING id, email, tier, tier_expires_at, renewal_reminded_at, referral_code, referred_by, referral_rewarded_at, marketing_opt_out, teaser_sent_at, created_at`;
        return rows[0] ? toUser(rows[0]) : null;
      },

      async retract(email, tier, days, now) {
        // Subtract the term the order sold, in one UPDATE, and drop to free when
        // nothing is left. Guarded on the tier so a later upgrade is not clipped
        // by an older order's refund, and on a non-null end so a comped account
        // — never bought — cannot be shortened.
        const rows = await sql<UserRow[]>`
          UPDATE users
             SET tier = CASE WHEN tier_expires_at - ${days} * interval '1 day' <= ${now} THEN 'free' ELSE tier END,
                 tier_expires_at = CASE WHEN tier_expires_at - ${days} * interval '1 day' <= ${now}
                                        THEN NULL ELSE tier_expires_at - ${days} * interval '1 day' END
           WHERE email = ${email.toLowerCase()} AND tier = ${tier} AND tier_expires_at IS NOT NULL
          RETURNING id, email, tier, tier_expires_at, renewal_reminded_at, referral_code, referred_by, referral_rewarded_at, marketing_opt_out, teaser_sent_at, created_at`;
        if (rows[0]) return toUser(rows[0]);
        // Nothing to take back: hand the row back unchanged rather than null,
        // which the contract reserves for an account that does not exist.
        const cur = await sql<UserRow[]>`
          SELECT id, email, tier, tier_expires_at, renewal_reminded_at, referral_code, referred_by, referral_rewarded_at, marketing_opt_out, teaser_sent_at, created_at
          FROM users WHERE email = ${email.toLowerCase()}`;
        return cur[0] ? toUser(cur[0]) : null;
      },

      async markRenewalReminded(email, now) {
        const rows = await sql<UserRow[]>`
          UPDATE users SET renewal_reminded_at = ${now} WHERE email = ${email.toLowerCase()}
          RETURNING id, email, tier, tier_expires_at, renewal_reminded_at, referral_code, referred_by, referral_rewarded_at, marketing_opt_out, teaser_sent_at, created_at`;
        return rows[0] ? toUser(rows[0]) : null;
      },

      async findByReferralCode(code) {
        const norm = normalizeCode(code);
        if (!norm) return null;
        const rows = await sql<UserRow[]>`
          SELECT id, email, tier, tier_expires_at, renewal_reminded_at, referral_code, referred_by, referral_rewarded_at, marketing_opt_out, teaser_sent_at, created_at
          FROM users WHERE referral_code = ${norm}`;
        return rows[0] ? toUser(rows[0]) : null;
      },

      async setReferredBy(email, code) {
        const norm = normalizeCode(code);
        if (!norm) {
          const rows = await sql<UserRow[]>`
            SELECT id, email, tier, tier_expires_at, renewal_reminded_at, referral_code, referred_by, referral_rewarded_at, marketing_opt_out, teaser_sent_at, created_at
            FROM users WHERE email = ${email.toLowerCase()}`;
          return rows[0] ? toUser(rows[0]) : null;
        }
        // Set once, and only to a DIFFERENT account's code — the WHERE clause is
        // the guard, so concurrency cannot slip a second write or a self-referral.
        const rows = await sql<UserRow[]>`
          UPDATE users u SET referred_by = ${norm}
           WHERE u.email = ${email.toLowerCase()} AND u.referred_by IS NULL
             AND EXISTS (SELECT 1 FROM users r WHERE r.referral_code = ${norm} AND r.email <> u.email)
          RETURNING u.id, u.email, u.tier, u.tier_expires_at, u.renewal_reminded_at, u.referral_code, u.referred_by, u.referral_rewarded_at, u.marketing_opt_out, u.teaser_sent_at, u.created_at`;
        if (rows[0]) return toUser(rows[0]);
        const cur = await sql<UserRow[]>`
          SELECT id, email, tier, tier_expires_at, renewal_reminded_at, referral_code, referred_by, referral_rewarded_at, marketing_opt_out, teaser_sent_at, created_at
          FROM users WHERE email = ${email.toLowerCase()}`;
        return cur[0] ? toUser(cur[0]) : null;
      },

      async markReferralRewarded(email, now) {
        const rows = await sql<UserRow[]>`
          UPDATE users SET referral_rewarded_at = ${now} WHERE email = ${email.toLowerCase()}
          RETURNING id, email, tier, tier_expires_at, renewal_reminded_at, referral_code, referred_by, referral_rewarded_at, marketing_opt_out, teaser_sent_at, created_at`;
        return rows[0] ? toUser(rows[0]) : null;
      },

      async setMarketingOptOut(email, optOut) {
        const rows = await sql<UserRow[]>`
          UPDATE users SET marketing_opt_out = ${optOut} WHERE email = ${email.toLowerCase()}
          RETURNING id, email, tier, tier_expires_at, renewal_reminded_at, referral_code, referred_by, referral_rewarded_at, marketing_opt_out, teaser_sent_at, created_at`;
        return rows[0] ? toUser(rows[0]) : null;
      },

      async markTeaserSent(email, now) {
        const rows = await sql<UserRow[]>`
          UPDATE users SET teaser_sent_at = ${now} WHERE email = ${email.toLowerCase()}
          RETURNING id, email, tier, tier_expires_at, renewal_reminded_at, referral_code, referred_by, referral_rewarded_at, marketing_opt_out, teaser_sent_at, created_at`;
        return rows[0] ? toUser(rows[0]) : null;
      },
    },

    orders: {
      async create(o: NewOrder, now) {
        const rows = await sql<OrderRow[]>`
          INSERT INTO orders (id, email, tier, plan, amount, status, provider, created_at)
          VALUES (${o.id}, ${o.email.toLowerCase()}, ${o.tier}, ${o.plan}, ${o.amount},
                  'pending', ${o.provider}, ${now})
          RETURNING id, email, tier, plan, amount, status, provider, provider_ref, created_at, paid_at, revoked_at`;
        return toOrder(rows[0]);
      },

      async get(id) {
        const rows = await sql<OrderRow[]>`
          SELECT id, email, tier, plan, amount, status, provider, provider_ref, created_at, paid_at, revoked_at
          FROM orders WHERE id = ${id}`;
        return rows[0] ? toOrder(rows[0]) : null;
      },

      async recent(limit) {
        const rows = await sql<OrderRow[]>`
          SELECT id, email, tier, plan, amount, status, provider, provider_ref, created_at, paid_at, revoked_at
          FROM orders ORDER BY created_at DESC LIMIT ${Math.max(0, limit)}`;
        return rows.map(toOrder);
      },

      // The status predicate is the idempotency lock: a replayed IPN updates
      // zero rows and returns null, so the caller grants only once. An explicit
      // ALLOW-list, never a deny-list — 'failed' is claimable because a transfer
      // can land after the abandonment sweep gave up, 'revoked' never is.
      async markPaid(id, providerRef, now) {
        const rows = await sql<OrderRow[]>`
          UPDATE orders SET status = 'paid', provider_ref = ${providerRef}, paid_at = ${now}
           WHERE id = ${id} AND status IN ('pending','failed')
          RETURNING id, email, tier, plan, amount, status, provider, provider_ref, created_at, paid_at, revoked_at`;
        return rows[0] ? toOrder(rows[0]) : null;
      },

      async expirePending(createdBefore) {
        const res = await sql`
          UPDATE orders SET status = 'failed'
           WHERE status = 'pending' AND created_at < ${createdBefore}`;
        return res.count;
      },

      // The mirror of markPaid: only 'paid' can be taken back, so a replayed
      // revoke updates zero rows and the entitlement is retracted exactly once.
      async markRevoked(id, now) {
        const rows = await sql<OrderRow[]>`
          UPDATE orders SET status = 'revoked', revoked_at = ${now}
           WHERE id = ${id} AND status = 'paid'
          RETURNING id, email, tier, plan, amount, status, provider, provider_ref, created_at, paid_at, revoked_at`;
        return rows[0] ? toOrder(rows[0]) : null;
      },
    },

    magicTokens: {
      async insert(t: NewMagicToken, now) {
        await sql`
          INSERT INTO magic_tokens (token_hash, email, redirect_to, created_at, expires_at)
          VALUES (${t.tokenHash}, ${t.email.toLowerCase()}, ${t.redirectTo}, ${now}, ${t.expiresAt})`;
      },

      async countRecent(email, since) {
        const rows = await sql<{ n: number }[]>`
          SELECT count(*)::int AS n FROM magic_tokens
          WHERE email = ${email.toLowerCase()} AND created_at > ${since}`;
        return rows[0].n;
      },

      // ONE conditional UPDATE: the single-use guarantee is the row lock, not
      // application logic. A SELECT then UPDATE would let two clicks both win.
      // Zero rows back means invalid, expired or already used — and an expired
      // token is left unconsumed, so it is still redeemable if the clock says so.
      async consume(tokenHash, now) {
        const rows = await sql<{ email: string; redirect_to: string }[]>`
          UPDATE magic_tokens SET consumed_at = ${now}
          WHERE token_hash = ${tokenHash} AND consumed_at IS NULL AND expires_at > ${now}
          RETURNING email, redirect_to`;
        return rows[0] ? { email: rows[0].email, redirectTo: rows[0].redirect_to } : null;
      },

      async purgeExpired(before) {
        const res = await sql`DELETE FROM magic_tokens WHERE expires_at < ${before}`;
        return res.count;
      },
    },

    watchlist: {
      async list(userId) {
        const rows = await sql<{ symbol: string }[]>`
          SELECT symbol FROM watchlist_items WHERE user_id = ${userId}
          ORDER BY added_at, symbol`;
        return rows.map((r) => r.symbol);
      },

      async add(userId, symbols) {
        if (symbols.length === 0) return;
        await sql`
          INSERT INTO watchlist_items (user_id, symbol)
          SELECT ${userId}, unnest(${sql.array([...new Set(symbols)])}::text[])
          ON CONFLICT DO NOTHING`;
      },

      async remove(userId, symbols) {
        if (symbols.length === 0) return;
        await sql`
          DELETE FROM watchlist_items
          WHERE user_id = ${userId} AND symbol = ANY(${sql.array(symbols)}::text[])`;
      },
    },

    alerts: {
      async list(userId) {
        const rows = await sql<AlertRow[]>`
          SELECT id, symbol, condition, price, created_at, triggered_at,
                 kind, pct, base_price, indicator, period
          FROM alerts WHERE user_id = ${userId} ORDER BY created_at`;
        return rows.map(toAlert);
      },

      async replace(userId, alerts) {
        await sql.begin(async (tx) => {
          await tx`DELETE FROM alerts WHERE user_id = ${userId}`;
          for (const a of alerts) {
            await tx`
              INSERT INTO alerts (user_id, id, symbol, condition, price, created_at, triggered_at,
                                  kind, pct, base_price, indicator, period)
              VALUES (${userId}, ${a.id}, ${a.symbol}, ${a.condition}, ${a.price},
                      ${new Date(a.createdAt)}, ${a.triggeredAt ? new Date(a.triggeredAt) : null},
                      ${a.kind ?? "price"}, ${a.pct ?? null}, ${a.basePrice ?? null},
                      ${a.indicator ?? null}, ${a.period ?? null})`;
          }
        });
      },
    },

    docs: {
      async list(userId, kind) {
        const rows = await sql<DocRow[]>`
          SELECT kind, key, data, version, updated_at FROM user_docs
          WHERE user_id = ${userId} AND kind = ${kind}
          ORDER BY updated_at, key`;
        return rows.map(toDoc);
      },

      async get(userId, kind, key) {
        const [row] = await sql<DocRow[]>`
          SELECT kind, key, data, version, updated_at FROM user_docs
          WHERE user_id = ${userId} AND kind = ${kind} AND key = ${key}`;
        return row ? toDoc(row) : null;
      },

      async put(userId, kind, key, data, now, ifVersion) {
        // The guard is inside the UPDATE's WHERE, not a read-then-write: two
        // devices saving at once would both pass a separate check and the second
        // would still clobber the first.
        const json = JSON.stringify(data);
        if (ifVersion !== undefined) {
          const [updated] = await sql<DocRow[]>`
            UPDATE user_docs SET data = ${json}::jsonb, version = version + 1, updated_at = ${now}
            WHERE user_id = ${userId} AND kind = ${kind} AND key = ${key} AND version = ${ifVersion}
            RETURNING kind, key, data, version, updated_at`;
          if (updated) return { saved: true, doc: toDoc(updated) };

          // Either the row moved on (conflict) or it never existed (a first write
          // that named a version). Hand back whatever is actually stored.
          const [current] = await sql<DocRow[]>`
            SELECT kind, key, data, version, updated_at FROM user_docs
            WHERE user_id = ${userId} AND kind = ${kind} AND key = ${key}`;
          if (current) return { saved: false, doc: toDoc(current) };
        }

        const [row] = await sql<DocRow[]>`
          INSERT INTO user_docs (user_id, kind, key, data, version, updated_at)
          VALUES (${userId}, ${kind}, ${key}, ${json}::jsonb, 1, ${now})
          ON CONFLICT (user_id, kind, key) DO UPDATE
            SET data = EXCLUDED.data, version = user_docs.version + 1, updated_at = EXCLUDED.updated_at
          RETURNING kind, key, data, version, updated_at`;
        return { saved: true, doc: toDoc(row) };
      },

      async remove(userId, kind, key) {
        await sql`DELETE FROM user_docs WHERE user_id = ${userId} AND kind = ${kind} AND key = ${key}`;
      },

      async count(userId, kind) {
        const [row] = await sql<{ n: string }[]>`
          SELECT count(*)::text AS n FROM user_docs WHERE user_id = ${userId} AND kind = ${kind}`;
        return Number(row?.n ?? 0);
      },

      async census() {
        const rows = await sql<{ user_id: string; kind: string }[]>`
          SELECT user_id, kind FROM user_docs`;
        return rows.map((r) => ({ userId: r.user_id, kind: r.kind }));
      },
    },

    series: {
      async append(series, points) {
        if (!points.length) return;
        // One statement, not one per point: a cron writing every gold series
        // would otherwise be a round trip per row. ON CONFLICT makes a re-run
        // on a day already recorded an update rather than a duplicate.
        const rows = points.map((p) => ({
          series, t: p.t, o: p.o, h: p.h, l: p.l, c: p.c, v: p.v ?? 0,
        }));
        await sql`
          INSERT INTO series_points ${sql(rows, "series", "t", "o", "h", "l", "c", "v")}
          ON CONFLICT (series, t) DO UPDATE
            SET o = EXCLUDED.o, h = EXCLUDED.h, l = EXCLUDED.l,
                c = EXCLUDED.c, v = EXCLUDED.v`;
      },

      async range(series, limit) {
        // Newest `limit` taken first, then flipped: a chart reads ascending, but
        // "the most recent N" is what the index can answer cheaply.
        const rows = await sql<{ t: string; o: number; h: number; l: number; c: number; v: number }[]>`
          SELECT t, o, h, l, c, v FROM series_points
          WHERE series = ${series}
          ORDER BY t DESC
          LIMIT ${Math.max(1, Math.min(5000, Math.floor(limit)))}`;
        return rows
          .map((r) => ({ t: Number(r.t), o: r.o, h: r.h, l: r.l, c: r.c, v: r.v }))
          .reverse();
      },

      async firstAt(series) {
        const [row] = await sql<{ t: string }[]>`
          SELECT min(t)::text AS t FROM series_points WHERE series = ${series}`;
        return row?.t ? Number(row.t) : null;
      },
    },

    briefs: {
      async put(day, data, now) {
        // `created_at` is left alone on conflict: the day a brief was first
        // published is what `datePublished` claims, and a re-run hours later
        // must not move it.
        await sql`
          INSERT INTO briefs (day, data, created_at, updated_at)
          VALUES (${day}::date, ${sql.json(data as never)}, ${now}, ${now})
          ON CONFLICT (day) DO UPDATE
            SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at`;
      },

      async get(day) {
        const [row] = await sql<{ day: string; data: unknown; created_at: Date; updated_at: Date }[]>`
          SELECT to_char(day, 'YYYY-MM-DD') AS day, data, created_at, updated_at
          FROM briefs WHERE day = ${day}::date`;
        return row
          ? { day: row.day, data: row.data, createdAt: row.created_at, updatedAt: row.updated_at }
          : null;
      },

      async recent(limit) {
        // The document is deliberately not selected: an index and a sitemap
        // need dates, and a year of briefs is megabytes of jsonb.
        const rows = await sql<{ day: string; updated_at: Date }[]>`
          SELECT to_char(day, 'YYYY-MM-DD') AS day, updated_at
          FROM briefs ORDER BY day DESC
          LIMIT ${Math.max(1, Math.min(1000, Math.floor(limit)))}`;
        return rows.map((r) => ({ day: r.day, updatedAt: r.updated_at }));
      },
    },
  };
}
