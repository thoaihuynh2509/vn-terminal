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

const [{ default: postgres }, { runMigrations }] = await Promise.all([
  import("postgres"),
  import("../packages/core/src/db/migrate.mjs"),
]);

// The ledger bootstrap re-emits "already exists, skipping" on every run.
const sql = postgres(url, {
  prepare: false, max: 1, idle_timeout: 20, connect_timeout: 10, onnotice: () => {},
});
try {
  const ran = await runMigrations(sql);
  console.log(ran.length ? `db:migrate — applied ${ran.join(", ")}` : "db:migrate — up to date.");
} catch (err) {
  console.error(`db:migrate — failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
} finally {
  await sql.end();
}
