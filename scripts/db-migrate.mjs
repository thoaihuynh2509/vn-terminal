/**
 * Applies pending migrations. Safe in any build command: with no DATABASE_URL
 * it reports that and exits 0, because a deployment without a database is a
 * supported configuration (auth and watchlist sync answer 501, the site serves).
 *
 *   npm run db:migrate
 */
// Migrations take a session advisory lock, which a TRANSACTION pooler (e.g.
// Supabase Supavisor on :6543) does not hold across statements. Prefer a direct
// / session connection here via MIGRATE_DATABASE_URL, falling back to
// DATABASE_URL for local dev where they are the same.
const url = process.env.MIGRATE_DATABASE_URL || process.env.DATABASE_URL;
if (!url) {
  console.log("db:migrate — DATABASE_URL is not set, nothing to migrate.");
  process.exit(0);
}

// A migration is a handful of DDL statements — seconds, not minutes. If it runs
// long it is almost always a TRANSACTION pooler (Supabase :6543): pg_advisory_lock
// cannot be held there, so the run STALLS instead of failing, and the build log
// looks empty. A hard timeout turns that silent hang into a readable error.
const TIMEOUT_MS = 60_000;
const POOLER_HINT =
  "MIGRATE_DATABASE_URL looks like a transaction pooler (:6543). Migrations need a " +
  "DIRECT / session connection (:5432) — advisory locks do not hold on the pooler. " +
  "Set MIGRATE_DATABASE_URL to the :5432 string (Supabase → Connect → Session/Direct).";

if (/:6543\b/.test(url) || /pooler/i.test(url)) {
  console.warn(`db:migrate — warning: ${POOLER_HINT}`);
}

const [{ default: postgres }, { runMigrations }] = await Promise.all([
  import("postgres"),
  import("../packages/core/src/db/migrate.mjs"),
]);

// The ledger bootstrap re-emits "already exists, skipping" on every run.
const sql = postgres(url, {
  prepare: false, max: 1, idle_timeout: 20, connect_timeout: 10, onnotice: () => {},
});

let timer;
const timeout = new Promise((_resolve, reject) => {
  timer = setTimeout(
    () => reject(new Error(`timed out after ${TIMEOUT_MS / 1000}s — ${POOLER_HINT}`)),
    TIMEOUT_MS,
  );
});

try {
  const ran = await Promise.race([runMigrations(sql), timeout]);
  console.log(ran.length ? `db:migrate — applied ${ran.join(", ")}` : "db:migrate — up to date.");
} catch (err) {
  console.error(`db:migrate — failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
} finally {
  clearTimeout(timer);
  // Force-close within 5s so a stuck connection cannot keep the process (and the
  // build) hanging after we have already decided the outcome.
  await sql.end({ timeout: 5 }).catch(() => {});
}
// Guarantee the process exits even if a hung handle would otherwise linger.
process.exit(process.exitCode ?? 0);
