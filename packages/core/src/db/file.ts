/**
 * File-backed driver — development and tests only.
 *
 * NOT a production driver, and the reasons are not theoretical:
 *   - two processes each load their own copy of the state, so the last writer
 *     wins and everything the other one wrote is gone;
 *   - Vercel's filesystem is read-only, so this driver cannot even start there.
 * Anything that must survive concurrency uses the postgres driver.
 *
 * Within one process the state is a `globalThis` singleton behind a promise
 * chain, so every read and every mutation runs alone. A module-level `const`
 * would not survive `next dev` hot reload — each reload would get its own
 * state and its own lock, which is no lock at all.
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PriceAlert } from "../alerts/alerts.ts";
import type { Db, DocRecord, NewMagicToken, NewOrder, OrderRecord, OrderStatus, StoredTier, UserRecord } from "./types.ts";
import { newReferralCode, normalizeCode } from "../billing/referral.ts";

interface UserRow {
  id: string;
  email: string;
  tier: StoredTier;
  tierExpiresAt: string | null;
  renewalRemindedAt: string | null;
  referralCode: string;
  referredBy: string | null;
  referralRewardedAt: string | null;
  marketingOptOut: boolean;
  teaserSentAt: string | null;
  createdAt: string;
}

interface OrderRow {
  id: string;
  email: string;
  tier: "plus" | "pro";
  plan: "monthly" | "annual";
  amount: number;
  status: OrderStatus;
  provider: string;
  providerRef: string | null;
  createdAt: string;
  paidAt: string | null;
}

interface TokenRow {
  tokenHash: string;
  email: string;
  redirectTo: string;
  createdAt: string;
  expiresAt: string;
  consumedAt: string | null;
}

interface WatchlistRow {
  userId: string;
  symbol: string;
  addedAt: string;
}

interface AlertRow {
  userId: string;
  alert: PriceAlert;
}

interface DocRow {
  userId: string;
  kind: string;
  key: string;
  data: unknown;
  version: number;
  updatedAt: string;
}

/** Rows are handed out as copies: the store is a live object in this process,
 *  and a caller mutating a returned doc would silently edit the database. */
const toDoc = (r: DocRow): DocRecord => ({
  kind: r.kind,
  key: r.key,
  data: structuredClone(r.data),
  version: r.version,
  updatedAt: new Date(r.updatedAt),
});

interface FileState {
  version: 1;
  users: UserRow[];
  magicTokens: TokenRow[];
  watchlistItems: WatchlistRow[];
  alerts: AlertRow[];
  orders: OrderRow[];
  docs: DocRow[];
  /** Optional: a store written before 008 has no series, and must still load. */
  series?: SeriesRow[];
}

interface SeriesRow {
  series: string;
  t: number;
  o: number; h: number; l: number; c: number; v: number;
}

interface Store {
  dir: string;
  state: FileState | null;
  chain: Promise<void>;
}

type FileDbGlobal = typeof globalThis & { __vnt_filedb?: Map<string, Store> };

const FILE = "db.json";
const TMP = "db.json.tmp";

const empty = (): FileState => ({
  version: 1,
  users: [],
  magicTokens: [],
  watchlistItems: [],
  alerts: [],
  orders: [],
  docs: [],
});

function store(dir: string): Store {
  const g = globalThis as FileDbGlobal;
  const stores = (g.__vnt_filedb ??= new Map<string, Store>());
  let s = stores.get(dir);
  if (!s) {
    s = { dir, state: null, chain: Promise.resolve() };
    stores.set(dir, s);
  }
  return s;
}

/**
 * A parsed file is not yet a valid store. `JSON.parse` happily returns `null`
 * or `{}`, and the cast would then lie all the way to a TypeError on the first
 * `.find`. The realistic way that happens is not a hand-edited file — it is a
 * later migration adding a table, which leaves every existing dev store without
 * that array.
 */
function isFileState(v: unknown): v is FileState {
  if (typeof v !== "object" || v === null) return false;
  const c = v as Record<string, unknown>;
  if (c.version !== 1) return false;
  return (
    Array.isArray(c.users) &&
    Array.isArray(c.magicTokens) &&
    Array.isArray(c.watchlistItems) &&
    Array.isArray(c.alerts)
  );
}

async function load(s: Store): Promise<FileState> {
  if (s.state) return s.state;
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(join(s.dir, FILE), "utf8"));
  } catch {
    parsed = undefined; // absent or unreadable: start clean, this is a dev store
  }
  // A store from a different shape or version starts clean rather than throwing.
  // A store from before a table was added keeps its rows — the new array and
  // column are backfilled, not treated as a shape mismatch that wipes dev data.
  if (isFileState(parsed)) {
    parsed.orders ??= [];
    parsed.docs ??= [];
    for (const u of parsed.users) {
      u.tierExpiresAt ??= null;
      u.renewalRemindedAt ??= null;
      u.referralCode ||= newReferralCode();
      u.referredBy ??= null;
      u.referralRewardedAt ??= null;
      u.marketingOptOut ??= false;
      u.teaserSentAt ??= null;
    }
    s.state = parsed;
  } else {
    s.state = empty();
  }
  return s.state;
}

/** Atomic on POSIX: readers never observe a half-written file. */
async function persist(s: Store, state: FileState): Promise<void> {
  const tmp = join(s.dir, TMP);
  await writeFile(tmp, JSON.stringify(state), "utf8");
  await rename(tmp, join(s.dir, FILE));
}

/**
 * The mutex. `fn` is SYNCHRONOUS on purpose: an await between reading the state
 * and writing it would open exactly the window that single-use tokens exist to
 * close.
 */
function withLock<T>(s: Store, mutates: boolean, fn: (state: FileState) => T): Promise<T> {
  const task = s.chain.then(async () => {
    const state = await load(s);
    const result = fn(state);
    if (mutates) await persist(s, state);
    return result;
  });
  s.chain = task.then(
    () => undefined,
    () => undefined,
  );
  return task;
}

const toUser = (r: UserRow): UserRecord => ({
  id: r.id,
  email: r.email,
  tier: r.tier,
  tierExpiresAt: r.tierExpiresAt ? new Date(r.tierExpiresAt) : null,
  renewalRemindedAt: r.renewalRemindedAt ? new Date(r.renewalRemindedAt) : null,
  referralCode: r.referralCode,
  referredBy: r.referredBy ?? null,
  referralRewardedAt: r.referralRewardedAt ? new Date(r.referralRewardedAt) : null,
  marketingOptOut: !!r.marketingOptOut,
  teaserSentAt: r.teaserSentAt ? new Date(r.teaserSentAt) : null,
  createdAt: new Date(r.createdAt),
});

const toOrder = (r: OrderRow): OrderRecord => ({
  id: r.id,
  email: r.email,
  tier: r.tier,
  plan: r.plan,
  amount: r.amount,
  status: r.status,
  provider: r.provider,
  providerRef: r.providerRef,
  createdAt: new Date(r.createdAt),
  paidAt: r.paidAt ? new Date(r.paidAt) : null,
});

export async function createFileDb(dir: string): Promise<Db> {
  await mkdir(dir, { recursive: true });
  const s = store(dir);

  return {
    users: {
      all: () => withLock(s, false, (state) => state.users.map(toUser)),

      findByEmail: (email) =>
        withLock(s, false, (state) => {
          const row = state.users.find((u) => u.email === email.toLowerCase());
          return row ? toUser(row) : null;
        }),

      upsertByEmail: (email) =>
        withLock(s, true, (state) => {
          const lower = email.toLowerCase();
          const existing = state.users.find((u) => u.email === lower);
          if (existing) return toUser(existing); // tier untouched
          const row: UserRow = {
            id: crypto.randomUUID(),
            email: lower,
            tier: "free",
            tierExpiresAt: null,
            renewalRemindedAt: null,
            referralCode: newReferralCode(),
            referredBy: null,
            referralRewardedAt: null,
            marketingOptOut: false,
            teaserSentAt: null,
            createdAt: new Date().toISOString(),
          };
          state.users.push(row);
          return toUser(row);
        }),

      setTier: (email, tier) =>
        withLock(s, true, (state) => {
          const row = state.users.find((u) => u.email === email.toLowerCase());
          if (!row) return null;
          row.tier = tier;
          if (tier === "free") row.tierExpiresAt = null; // no dangling expiry on a free row
          return toUser(row);
        }),

      grant: (email, tier, expiresAt) =>
        withLock(s, true, (state) => {
          const row = state.users.find((u) => u.email === email.toLowerCase());
          if (!row) return null;
          // Extend from the later of now and any live subscription, so a renewal
          // stacks rather than shortening the term already paid for.
          const current = row.tierExpiresAt ? new Date(row.tierExpiresAt).getTime() : 0;
          const base = Math.max(Date.now(), row.tier === tier ? current : 0);
          const added = expiresAt.getTime() - Date.now();
          row.tier = tier;
          row.tierExpiresAt = new Date(base + added).toISOString();
          row.renewalRemindedAt = null; // a fresh term is a fresh thing to remind about
          return toUser(row);
        }),

      markRenewalReminded: (email, now) =>
        withLock(s, true, (state) => {
          const row = state.users.find((u) => u.email === email.toLowerCase());
          if (!row) return null;
          row.renewalRemindedAt = now.toISOString();
          return toUser(row);
        }),

      findByReferralCode: (code) =>
        withLock(s, false, (state) => {
          const norm = normalizeCode(code);
          if (!norm) return null;
          const row = state.users.find((u) => u.referralCode === norm);
          return row ? toUser(row) : null;
        }),

      setReferredBy: (email, code) =>
        withLock(s, true, (state) => {
          const row = state.users.find((u) => u.email === email.toLowerCase());
          if (!row || row.referredBy) return row ? toUser(row) : null; // set once
          const norm = normalizeCode(code);
          if (!norm) return toUser(row);
          const referrer = state.users.find((u) => u.referralCode === norm);
          if (!referrer || referrer.email === row.email) return toUser(row); // no self-referral
          row.referredBy = norm;
          return toUser(row);
        }),

      markReferralRewarded: (email, now) =>
        withLock(s, true, (state) => {
          const row = state.users.find((u) => u.email === email.toLowerCase());
          if (!row) return null;
          row.referralRewardedAt = now.toISOString();
          return toUser(row);
        }),

      setMarketingOptOut: (email, optOut) =>
        withLock(s, true, (state) => {
          const row = state.users.find((u) => u.email === email.toLowerCase());
          if (!row) return null;
          row.marketingOptOut = optOut;
          return toUser(row);
        }),

      markTeaserSent: (email, now) =>
        withLock(s, true, (state) => {
          const row = state.users.find((u) => u.email === email.toLowerCase());
          if (!row) return null;
          row.teaserSentAt = now.toISOString();
          return toUser(row);
        }),
    },

    orders: {
      create: (o: NewOrder, now) =>
        withLock(s, true, (state) => {
          const row: OrderRow = {
            id: o.id,
            email: o.email.toLowerCase(),
            tier: o.tier,
            plan: o.plan,
            amount: o.amount,
            status: "pending",
            provider: o.provider,
            providerRef: null,
            createdAt: now.toISOString(),
            paidAt: null,
          };
          state.orders.push(row);
          return toOrder(row);
        }),

      get: (id) =>
        withLock(s, false, (state) => {
          const row = state.orders.find((o) => o.id === id);
          return row ? toOrder(row) : null;
        }),

      recent: (limit) =>
        withLock(s, false, (state) =>
          [...state.orders]
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
            .slice(0, Math.max(0, limit))
            .map(toOrder),
        ),

      // Flip inside ONE lock and only from pending, so a replayed IPN sees a row
      // already 'paid' and returns null — the grant happens exactly once.
      markPaid: (id, providerRef, now) =>
        withLock(s, true, (state) => {
          const row = state.orders.find((o) => o.id === id);
          if (!row || row.status !== "pending") return null;
          row.status = "paid";
          row.providerRef = providerRef;
          row.paidAt = now.toISOString();
          return toOrder(row);
        }),
    },

    magicTokens: {
      insert: (t: NewMagicToken, now) =>
        withLock(s, true, (state) => {
          state.magicTokens.push({
            tokenHash: t.tokenHash,
            email: t.email.toLowerCase(),
            redirectTo: t.redirectTo,
            createdAt: now.toISOString(),
            expiresAt: t.expiresAt.toISOString(),
            consumedAt: null,
          });
        }),

      countRecent: (email, since) =>
        withLock(s, false, (state) => {
          const lower = email.toLowerCase();
          return state.magicTokens.filter(
            (t) => t.email === lower && new Date(t.createdAt).getTime() > since.getTime(),
          ).length;
        }),

      // Find, check and set inside ONE lock acquisition — the equivalent of the
      // conditional UPDATE ... RETURNING the postgres driver runs.
      consume: (tokenHash, now) =>
        withLock(s, true, (state) => {
          const row = state.magicTokens.find((t) => t.tokenHash === tokenHash);
          if (!row || row.consumedAt !== null) return null;
          if (new Date(row.expiresAt).getTime() <= now.getTime()) return null; // > now, not >=
          row.consumedAt = now.toISOString();
          return { email: row.email, redirectTo: row.redirectTo };
        }),

      purgeExpired: (before) =>
        withLock(s, true, (state) => {
          const kept = state.magicTokens.filter(
            (t) => new Date(t.expiresAt).getTime() >= before.getTime(),
          );
          const removed = state.magicTokens.length - kept.length;
          state.magicTokens = kept;
          return removed;
        }),
    },

    watchlist: {
      list: (userId) =>
        withLock(s, false, (state) =>
          state.watchlistItems.filter((w) => w.userId === userId).map((w) => w.symbol),
        ),

      add: (userId, symbols) =>
        withLock(s, true, (state) => {
          for (const symbol of symbols) {
            const present = state.watchlistItems.some(
              (w) => w.userId === userId && w.symbol === symbol,
            );
            if (present) continue;
            state.watchlistItems.push({ userId, symbol, addedAt: new Date().toISOString() });
          }
        }),

      remove: (userId, symbols) =>
        withLock(s, true, (state) => {
          state.watchlistItems = state.watchlistItems.filter(
            (w) => w.userId !== userId || !symbols.includes(w.symbol),
          );
        }),
    },

    alerts: {
      list: (userId) =>
        withLock(s, false, (state) =>
          state.alerts.filter((a) => a.userId === userId).map((a) => ({ ...a.alert })),
        ),

      replace: (userId, alerts) =>
        withLock(s, true, (state) => {
          state.alerts = state.alerts.filter((a) => a.userId !== userId);
          for (const alert of alerts) state.alerts.push({ userId, alert: { ...alert } });
        }),
    },

    docs: {
      list: (userId, kind) =>
        withLock(s, false, (state) =>
          state.docs
            .filter((d) => d.userId === userId && d.kind === kind)
            .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt) || a.key.localeCompare(b.key))
            .map(toDoc),
        ),

      get: (userId, kind, key) =>
        withLock(s, false, (state) => {
          const row = state.docs.find((d) => d.userId === userId && d.kind === kind && d.key === key);
          return row ? toDoc(row) : null;
        }),

      put: (userId, kind, key, data, now, ifVersion) =>
        withLock(s, true, (state) => {
          const row = state.docs.find((d) => d.userId === userId && d.kind === kind && d.key === key);
          // A stale write loses and gets the current row back, so the caller can
          // merge instead of overwriting another device's change.
          if (ifVersion !== undefined && row && row.version !== ifVersion) {
            return { saved: false, doc: toDoc(row) };
          }
          if (row) {
            row.data = data;
            row.version += 1;
            row.updatedAt = now.toISOString();
            return { saved: true, doc: toDoc(row) };
          }
          const fresh: DocRow = { userId, kind, key, data, version: 1, updatedAt: now.toISOString() };
          state.docs.push(fresh);
          return { saved: true, doc: toDoc(fresh) };
        }),

      remove: (userId, kind, key) =>
        withLock(s, true, (state) => {
          state.docs = state.docs.filter(
            (d) => d.userId !== userId || d.kind !== kind || d.key !== key,
          );
        }),

      count: (userId, kind) =>
        withLock(s, false, (state) =>
          state.docs.filter((d) => d.userId === userId && d.kind === kind).length,
        ),
    },

    series: {
      append: (series, points) =>
        withLock(s, true, (state) => {
          state.series ??= [];
          for (const p of points) {
            const at = state.series.findIndex((x) => x.series === series && x.t === p.t);
            const row = { series, t: p.t, o: p.o, h: p.h, l: p.l, c: p.c, v: p.v ?? 0 };
            if (at === -1) state.series.push(row);
            else state.series[at] = row;
          }
        }),

      range: (series, limit) =>
        withLock(s, false, (state) =>
          (state.series ?? [])
            .filter((x) => x.series === series)
            .sort((a, b) => a.t - b.t)
            .slice(-Math.max(1, Math.floor(limit)))
            .map(({ t, o, h, l, c, v }) => ({ t, o, h, l, c, v })),
        ),

      firstAt: (series) =>
        withLock(s, false, (state) => {
          const ts = (state.series ?? []).filter((x) => x.series === series).map((x) => x.t);
          return ts.length ? Math.min(...ts) : null;
        }),
    },
  };
}
