import { readFileSync } from "node:fs";

/**
 * Load `.env.local` the way Next does: values already in the environment win.
 *
 * Plain `node` does not read env files, so a script run outside `next` sees
 * nothing and reports "DATABASE_URL is not set" on a machine that is correctly
 * configured — the one answer guaranteed to send someone looking in the wrong
 * place. On Vercel the platform injects the variables and this finds no file,
 * which is the intended no-op.
 *
 * Returns where each name came from, so a caller can say so rather than leaving
 * the reader to guess which of several possible sources won.
 */
export function loadEnvLocal(file = ".env.local") {
  const source = {};
  const fromFile = {};
  let lines = [];
  try {
    lines = readFileSync(file, "utf8").split("\n");
  } catch {
    return { source, fromFile };
  }
  for (const line of lines) {
    const m = /^\s*([A-Z0-9_]+)\s*=(.*)$/.exec(line);
    if (!m) continue;
    fromFile[m[1]] = m[2];
    if (process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2];
      source[m[1]] = ".env.local";
    } else {
      source[m[1]] = "shell environment (also in .env.local)";
    }
  }
  return { source, fromFile };
}
