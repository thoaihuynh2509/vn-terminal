/**
 * Applies pending migrations. Safe in any build command: with no DATABASE_URL
 * it reports that and exits 0, because a deployment without a database is a
 * supported configuration (auth and watchlist sync answer 501, the site serves).
 *
 *   npm run db:migrate
 */
import { loadEnvLocal } from "./load-env.mjs";
// Migrations take a session advisory lock, which a TRANSACTION pooler (e.g.
// Supabase Supavisor on :6543) does not hold across statements. Prefer a direct
// / session connection here via MIGRATE_DATABASE_URL, falling back to
// DATABASE_URL for local dev where they are the same.
// Plain `node` reads no env file, so without this the script reports "not set"
// on a correctly configured machine. On Vercel there is no file and the
// platform's own variables are used, which is the intended no-op.
loadEnvLocal();

const raw = process.env.MIGRATE_DATABASE_URL || process.env.DATABASE_URL;
const url = raw && raw.trim();
if (!url) {
  console.log("db:migrate — DATABASE_URL is not set, nothing to migrate.");
  process.exit(0);
}

// A malformed connection string — an unreplaced "[YOUR-PASSWORD]" placeholder
// (the brackets parse as an IPv6 host), a password with an unencoded @ # ? / :,
// or stray quotes/whitespace — makes postgres() throw a raw "Invalid URL" that
// would fail the WHOLE build (db:migrate && next build). Treat it like an
// unusable database: warn loudly with the fix and skip (exit 0), so the site
// still deploys and DB features stay fail-closed at runtime, instead of the
// deploy dying on an env-var typo.
const BAD_URL_HINT =
  "MIGRATE_DATABASE_URL is not a valid Postgres URL. Check that: (1) the " +
  "[YOUR-PASSWORD] placeholder is actually replaced, (2) special characters in " +
  "the password are percent-encoded (@ -> %40, # -> %23, / -> %2F, : -> %3A), " +
  "(3) there are no surrounding quotes or spaces. Use the :5432 Session/Direct " +
  "string from Supabase -> Connect.";
try {
  new URL(url);
} catch {
  console.error(`db:migrate — skipped: ${BAD_URL_HINT}`);
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

// The PORT decides, not the hostname. Supabase serves session mode on the same
// `*.pooler.supabase.com` host at :5432, so matching the host warned about a
// correct configuration — and a warning that fires when nothing is wrong is how
// people learn to ignore warnings.
if (/:6543\b/.test(url)) {
  console.warn(`db:migrate — warning: ${POOLER_HINT}`);
}

const [{ default: postgres }, { runMigrations }] = await Promise.all([
  import("postgres"),
  import("../packages/core/src/db/migrate.mjs"),
]);

// The ledger bootstrap re-emits "already exists, skipping" on every run.
let sql;
try {
  sql = postgres(url, {
    prepare: false, max: 1, idle_timeout: 20, connect_timeout: 10, onnotice: () => {},
  });
} catch {
  console.error(`db:migrate — skipped: ${BAD_URL_HINT}`);
  process.exit(0);
}

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
