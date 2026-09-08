/**
 * Tells you what is wrong with the database connection string — without ever
 * printing it.
 *
 *   npm run db:check
 *
 * `db:migrate` already refuses a malformed URL with a hint, but only during a
 * build, and only for the migrate URL. This is the thing you can run before
 * deploying, on either variable, that says which of the usual mistakes was made
 * and then proves the connection actually works.
 *
 * Nothing here echoes the value. The report is a redacted SHAPE — letters as
 * `a`, digits as `9` — which is enough to spot every failure below and safe to
 * paste into a chat or an issue.
 */
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { MIGRATIONS } from "../packages/core/src/db/migrations.mjs";

/**
 * Next loads `.env.local` itself; plain node does not. Without this the check
 * would report "not set" on a machine where the app is perfectly configured,
 * which is the one answer guaranteed to mislead. Values already in the
 * environment win, matching Next's own precedence.
 *
 * WHERE each value came from is reported, because the precedence itself is a
 * trap: `export DATABASE_URL=...` in one terminal makes this check pass while
 * `.env.local` stays broken and nothing is persisted. The check goes green, and
 * another terminal, a fresh build, and the deploy all still fail. Saying the
 * source turns that into a visible fact instead of a mystery.
 */
const SOURCE = {};
const fromFile = {};
try {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=(.*)$/.exec(line);
    if (!m) continue;
    fromFile[m[1]] = m[2];
    if (process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2];
      SOURCE[m[1]] = ".env.local";
    } else {
      // Present in both: the shell wins here and for `next dev` in this same
      // shell, but NOT anywhere else.
      SOURCE[m[1]] = "shell environment (also in .env.local)";
    }
  }
} catch {
  /* no .env.local: the environment is the only source, which is the CI case */
}
for (const n of ["DATABASE_URL", "MIGRATE_DATABASE_URL"]) {
  if (process.env[n] !== undefined && !SOURCE[n]) SOURCE[n] = "shell environment";
}

/** A value exported in this shell only, which nothing outside it will see. */
const shellOnly = (name) => SOURCE[name] === "shell environment";
/** Exported here AND present in the file with a DIFFERENT value. */
const shadowed = (name) =>
  SOURCE[name] === "shell environment (also in .env.local)" &&
  fromFile[name] !== undefined &&
  fromFile[name].trim().replace(/^["\']|["\']$/g, "") !== process.env[name].trim().replace(/^["\']|["\']$/g, "");

const NAMES = ["DATABASE_URL", "MIGRATE_DATABASE_URL"];

/** Letters to `a`, digits to `9`. Structure survives; the secret does not. */
const shape = (v) => v.replace(/[A-Za-z]/g, "a").replace(/[0-9]/g, "9");

/**
 * The mistakes that actually happen, in the order they are worth reporting.
 * Each returns a sentence, or null when that check passes.
 */
function diagnose(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return "empty.";
  if (/^["']|["']$/.test(trimmed)) {
    return "wrapped in quotes. Vercel and .env files both take the value raw — remove them.";
  }
  const v = trimmed;
  if (/[<>]/.test(v)) {
    return "still contains a <placeholder> from the copied template. Replace every <…> with the real value.";
  }
  if (/\[YOUR-PASSWORD\]|\[YOUR_PASSWORD\]/i.test(v)) {
    return "still contains the [YOUR-PASSWORD] placeholder. Paste the real password.";
  }
  if (/\s/.test(v)) return "contains a space or newline.";

  try {
    const u = new URL(v);
    if (!/^postgres(ql)?:$/.test(u.protocol)) {
      return `has scheme "${u.protocol}" — expected postgres:// or postgresql://.`;
    }
    if (u.port === "6543") {
      return "points at the TRANSACTION pooler (:6543). Migrations take a session " +
        "advisory lock, which that pooler cannot hold, so the run stalls rather than " +
        "failing. Use the :5432 Session/Direct string from Supabase → Connect.";
    }
    // `new URL` is lenient: it splits on the LAST @, so a password containing an
    // unencoded @ parses cleanly and then authenticates as the wrong user. That
    // is the worst kind of failure — it looks like bad credentials — so it is
    // worth naming even though the format check passed.
    if ((v.match(/@/g) || []).length > 1) {
      return "parses, but contains more than one @, which almost always means an " +
        "unencoded @ in the password. Node splits on the LAST one, so this will " +
        "connect as the wrong user and look like a bad password. " +
        "Encode it (@ → %40), and likewise # → %23, / → %2F, : → %3A.";
    }
    return null;
  } catch {
    // `new URL` refuses before telling us why, so name the likeliest cause.
    const at = (v.match(/@/g) || []).length;
    if (at > 1) {
      return "has more than one @ — the password contains an unencoded @. " +
        "Percent-encode it (@ → %40), and likewise # → %23, / → %2F, : → %3A.";
    }
    return "is not a parseable URL. The usual cause is an unencoded special " +
      "character in the password (@ → %40, # → %23, / → %2F, : → %3A).";
  }
}

let bad = 0;
const usable = {};

for (const name of NAMES) {
  const raw = process.env[name];
  if (raw === undefined) {
    // Only DATABASE_URL is required; the migrate URL falls back to it.
    if (name === "DATABASE_URL") { console.log(`${name}\n  not set — the app runs without a database and DB features answer 501.`); }
    else { console.log(`${name}\n  not set — falls back to DATABASE_URL.`); }
    continue;
  }
  const problem = diagnose(raw);
  console.log(name);
  console.log(`  source  ${SOURCE[name] ?? "shell environment"}`);
  console.log(`  shape   ${shape(raw.trim().replace(/^["']|["']$/g, "")).slice(0, 100)}`);
  if (problem) {
    console.log(`  PROBLEM ${problem}`);
    bad++;
  } else {
    console.log("  format  ok");
    usable[name] = raw.trim();
  }

  // Green here is not green anywhere else if the value lives only in this shell.
  if (shellOnly(name)) {
    console.log("  NOTE    set in this shell only — not in .env.local, so another");
    console.log("          terminal, a fresh build, and Vercel will not see it.");
  } else if (shadowed(name)) {
    console.log("  NOTE    this shell's export DIFFERS from the .env.local value and");
    console.log("          wins here. The file's value is what a fresh terminal uses.");
  }
}

const url = usable.MIGRATE_DATABASE_URL || usable.DATABASE_URL;
if (!url) {
  console.log("\nNo usable connection string, so nothing was contacted.");
  process.exit(bad ? 1 : 0);
}

// Format being right is not the same as the credentials being right, and the
// difference is exactly what a deploy discovers the hard way.
console.log("\nConnecting…");
const sql = postgres(url, { max: 1, idle_timeout: 5, connect_timeout: 10, onnotice: () => {} });
try {
  const [{ now }] = await sql`SELECT now()`;
  console.log(`  connected (server time ${now.toISOString()})`);

  const applied = await sql`SELECT id FROM schema_migrations`.catch(() => []);
  const have = new Set(applied.map((r) => r.id));
  const pending = MIGRATIONS.filter((m) => !have.has(m.id)).map((m) => m.id);
  console.log(`  migrations applied ${have.size}/${MIGRATIONS.length}`);
  if (pending.length) {
    console.log(`  PENDING: ${pending.join(", ")}`);
    console.log("  run `npm run db:migrate`, or redeploy — the build runs it.");
  } else {
    console.log("  schema is up to date.");
  }
} catch (e) {
  // A credential or network failure, not a formatting one.
  console.log(`  FAILED: ${e.message}`);
  console.log("  the string parses, so this is the credentials, the host, or network access.");
  bad++;
} finally {
  await sql.end({ timeout: 5 });
}

process.exit(bad ? 1 : 0);
