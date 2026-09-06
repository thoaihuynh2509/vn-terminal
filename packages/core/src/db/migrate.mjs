/**
 * Migration runner. Invoked by `npm run db:migrate`, NEVER from a request:
 * DDL on cold start races between serverless instances.
 */
import { MIGRATIONS } from "./migrations.mjs";

/** Arbitrary but fixed: every deploy must contend for the same advisory lock. */
const LOCK_ID = 4198320145;

/** Applies every migration not yet recorded. Returns the ids it ran. */
export async function runMigrations(sql) {
  // The one permitted IF NOT EXISTS: the ledger bootstraps itself.
  await sql`CREATE TABLE IF NOT EXISTS schema_migrations (
    id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now()
  )`;

  // One reserved connection throughout — a session advisory lock taken on a
  // pooled connection would not be held by the queries that follow it.
  const conn = await sql.reserve();
  try {
    await conn`SELECT pg_advisory_lock(${LOCK_ID}::bigint)`;
    try {
      const rows = await conn`SELECT id FROM schema_migrations`;
      const applied = new Set(rows.map((r) => r.id));
      const known = new Set(MIGRATIONS.map((m) => m.id));
      for (const id of applied) {
        if (!known.has(id)) {
          // The database has run something this code does not know about.
          // Guessing what to apply on top of it is how data gets destroyed.
          throw new Error(`schema drift: ${id} is applied but is not in MIGRATIONS`);
        }
      }

      const ran = [];
      for (const m of MIGRATIONS) {
        if (applied.has(m.id)) continue;
        // Explicit transaction control rather than sql.begin: a reserved
        // connection has no begin(), and the transaction must run on the same
        // connection that holds the advisory lock.
        await conn`BEGIN`;
        try {
          await conn.unsafe(m.sql);
          await conn`INSERT INTO schema_migrations (id) VALUES (${m.id})`;
          await conn`COMMIT`;
        } catch (err) {
          await conn`ROLLBACK`;
          throw err;
        }
        ran.push(m.id);
      }
      return ran;
    } finally {
      await conn`SELECT pg_advisory_unlock(${LOCK_ID}::bigint)`;
    }
  } finally {
    conn.release();
  }
}
