/**
 * Writes the two connection strings into .env.local without the password ever
 * being visible.
 *
 *   npm run db:url
 *
 * The password is read with echo off, percent-encoded, and written straight to
 * the file. It is never printed, never passed as an argument (which would put it
 * in `ps` and shell history), and never returned to the caller.
 *
 * Two strings, not one, and the difference is the whole point:
 *
 *   DATABASE_URL          :6543  transaction pooler — right for serverless
 *                                request handling, many short connections.
 *   MIGRATE_DATABASE_URL  :5432  session mode — migrations take a session
 *                                advisory lock, which the transaction pooler
 *                                cannot hold. Pointed at :6543 a migration does
 *                                not fail; it STALLS, and the build log looks
 *                                empty.
 */
import { createInterface } from "node:readline";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const FILE = ".env.local";

function ask(question, { hidden = false } = {}) {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  return new Promise((resolve) => {
    if (hidden) {
      // Suppress the echo of typed characters; the prompt itself still prints.
      const onData = () => { rl.output.write(`\r${question}`); };
      rl.input.on("data", onData);
      rl.question(question, (a) => { rl.input.off("data", onData); rl.output.write("\n"); rl.close(); resolve(a); });
    } else {
      rl.question(question, (a) => { rl.close(); resolve(a); });
    }
  });
}

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")),
);

const host = args.host || (await ask("Pooler host (aws-0-<region>.pooler.supabase.com): "));
const user = args.user || (await ask("User (postgres.<project-ref>): "));
const db = args.db || "postgres";
const password = await ask("Password (not echoed): ", { hidden: true });

if (!host.trim() || !user.trim() || !password) {
  console.error("host, user and password are all required.");
  process.exit(1);
}

// Encoded, so an @ # / : or ? in the password cannot break the URL — the failure
// that parses cleanly and then authenticates as the wrong user.
const pw = encodeURIComponent(password);
const url = (port) => `postgres://${user.trim()}:${pw}@${host.trim()}:${port}/${db.trim()}`;

const lines = existsSync(FILE) ? readFileSync(FILE, "utf8").split("\n") : [];
const without = lines.filter((l) => !/^\s*(DATABASE_URL|MIGRATE_DATABASE_URL)\s*=/.test(l));
const next = [
  ...without.filter((l, i, a) => !(l === "" && a[i + 1] === undefined)),
  `DATABASE_URL=${url(6543)}`,
  `MIGRATE_DATABASE_URL=${url(5432)}`,
  "",
].join("\n");
writeFileSync(FILE, next, { mode: 0o600 });

console.log(`\nWrote DATABASE_URL (:6543, transaction pooler) and MIGRATE_DATABASE_URL (:5432, session) to ${FILE}.`);
console.log("Nothing was printed. Verify with:  npm run db:check");
