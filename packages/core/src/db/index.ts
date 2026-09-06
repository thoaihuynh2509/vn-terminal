/**
 * Driver selection.
 *
 * A missing DATABASE_URL degrades auth and watchlist sync, never the site:
 * `activeDbDriver()` answers "none" and callers answer 501 rather than throw.
 * Same invariant as a missing AUTH_SECRET.
 */
import { join } from "node:path";
import { createFileDb } from "./file.ts";
import { DbUnavailableError, type Db, type DbDriver } from "./types.ts";

export function activeDbDriver(): DbDriver {
  if (process.env.DATABASE_URL) return "postgres";
  if (process.env.DB_DRIVER === "file" || process.env.NODE_ENV !== "production") return "file";
  return "none";
}

export function dbAvailable(): boolean {
  return activeDbDriver() !== "none";
}

export async function getDb(): Promise<Db> {
  const url = process.env.DATABASE_URL;
  if (url) {
    // Lazy so a file-driver deployment never loads the postgres client.
    const { createPostgresDb } = await import("./postgres.ts");
    return createPostgresDb(url);
  }
  if (activeDbDriver() === "file") {
    return createFileDb(join(process.cwd(), ".data"));
  }
  throw new DbUnavailableError("no database configured");
}

export { DbUnavailableError } from "./types.ts";
export type { Db, DbDriver, NewMagicToken, NewOrder, OrderRecord, OrderStatus, StoredTier, UserRecord } from "./types.ts";
