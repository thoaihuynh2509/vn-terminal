/**
 * Persistence contract.
 *
 * STUB — signatures only, written test-first. The implementer replaces the
 * driver modules; this file is the shape both drivers must satisfy.
 *
 * `now` is passed in by the caller on insert and consume so expiry uses one
 * clock and tests can inject time.
 */
import type { Tier } from "../auth/entitlement.ts";
import type { PriceAlert } from "../alerts/alerts.ts";

/** `anon` is a session state, never a stored tier. */
export type StoredTier = Exclude<Tier, "anon">;

export type DbDriver = "postgres" | "file" | "none";

export interface UserRecord {
  id: string;
  email: string;
  tier: StoredTier;
  /** Subscription end, or null for free / a comped tier with no end. */
  tierExpiresAt: Date | null;
  /**
   * When a renewal reminder was last sent for the CURRENT term. Cleared on every
   * grant (a renewal starts a fresh term to remind about), so the reminder is
   * sent once per term, never daily through the whole expiry window.
   */
  renewalRemindedAt: Date | null;
  /** This account's own public referral code, to share. */
  referralCode: string;
  /** The referral code that brought this account in, or null. */
  referredBy: string | null;
  /** When this account's first paid order credited its referrer (pays once). */
  referralRewardedAt: Date | null;
  /** Reader has unsubscribed from the weekly teaser. Default false = opted in. */
  marketingOptOut: boolean;
  /** When the last teaser was sent, so it goes out weekly, not on every run. */
  teaserSentAt: Date | null;
  createdAt: Date;
}

/**
 * `revoked` is the owner taking a manual settlement back — a distinct state, not
 * a `failed`, because a failure may still be paid late while a revoke never can.
 */
export type OrderStatus = "pending" | "paid" | "failed" | "revoked";

/** A purchase attempt. The ledger that makes an IPN idempotent and payments reconcilable. */
export interface OrderRecord {
  id: string;
  email: string;
  tier: "plus" | "pro";
  plan: "monthly" | "annual";
  amount: number;
  status: OrderStatus;
  provider: string;
  providerRef: string | null;
  createdAt: Date;
  paidAt: Date | null;
  revokedAt: Date | null;
}

export interface NewOrder {
  id: string;
  email: string;
  tier: "plus" | "pro";
  plan: "monthly" | "annual";
  amount: number;
  provider: string;
}

/** One saved chart artifact. `data` is opaque to the database layer. */
export interface DocRecord {
  kind: string;
  key: string;
  data: unknown;
  version: number;
  updatedAt: Date;
}

export interface NewMagicToken {
  tokenHash: string;
  email: string;
  redirectTo: string;
  expiresAt: Date;
}

/** One recorded point. `t` is a unix second, matching `Bar`. */
export interface SeriesPoint {
  t: number;
  o: number; h: number; l: number; c: number; v?: number;
}

export interface Db {
  users: {
    findByEmail(email: string): Promise<UserRecord | null>;
    /** Every account, for server jobs (cron delivery). Small scale by design. */
    all(): Promise<UserRecord[]>;
    /**
     * Creates with tier 'free' when absent; an existing row's tier is untouched.
     * `created` distinguishes a sign-up from a returning reader, so a conversion
     * is only reported for a genuinely new account.
     */
    upsertByEmail(email: string): Promise<UserRecord & { created: boolean }>;
    setTier(email: string, tier: StoredTier): Promise<UserRecord | null>;
    /**
     * Grant a paid tier until `expiresAt`. Extends from the later of now and any
     * live subscription so a renewal adds time rather than resetting it.
     */
    grant(email: string, tier: "plus" | "pro", expiresAt: Date): Promise<UserRecord | null>;
    /**
     * Take back `days` of a tier, for an order settled by mistake. SUBTRACTS the
     * term rather than zeroing it, so revoking a mis-settled RENEWAL leaves the
     * months the subscriber did pay for. Only acts when the row still holds
     * `tier` and has an end date; dropping to or past now downgrades to free.
     */
    retract(email: string, tier: "plus" | "pro", days: number, now: Date): Promise<UserRecord | null>;
    /** Record that a renewal reminder was sent for the current term. */
    markRenewalReminded(email: string, now: Date): Promise<UserRecord | null>;
    findByReferralCode(code: string): Promise<UserRecord | null>;
    /**
     * Attribute an account to a referrer's code — only if it has none yet and the
     * code is a DIFFERENT account's (no self-referral). No-op otherwise.
     */
    setReferredBy(email: string, code: string): Promise<UserRecord | null>;
    /** Mark that this account's purchase has already credited its referrer. */
    markReferralRewarded(email: string, now: Date): Promise<UserRecord | null>;
    /** Set the teaser unsubscribe flag (an unsubscribe link, or a re-opt-in). */
    setMarketingOptOut(email: string, optOut: boolean): Promise<UserRecord | null>;
    /** Record that a weekly teaser was just sent. */
    markTeaserSent(email: string, now: Date): Promise<UserRecord | null>;
  };
  orders: {
    create(o: NewOrder, now: Date): Promise<OrderRecord>;
    get(id: string): Promise<OrderRecord | null>;
    /** Most-recent orders first, for the owner's reconciliation view. */
    recent(limit: number): Promise<OrderRecord[]>;
    /**
     * Idempotent claim of an unsettled order. Returns the order ONLY on the call
     * that actually flipped it, so a replayed IPN grants exactly once; null on
     * any later call. The claimable states are an explicit ALLOW-list of
     * 'pending' and 'failed' — money that lands after the abandonment sweep is
     * still money — and never 'paid' or 'revoked', so a replay cannot re-grant
     * an order the owner took back.
     */
    markPaid(id: string, providerRef: string, now: Date): Promise<OrderRecord | null>;
    /**
     * Fail every pending order created STRICTLY before `createdBefore`, and
     * return how many. Idempotent: a second sweep of the same window finds
     * nothing pending left to fail.
     */
    expirePending(createdBefore: Date): Promise<number>;
    /**
     * Idempotent paid→revoked, the mirror of `markPaid`. Returns the order ONLY
     * on the call that flipped it, so the entitlement is taken back once.
     */
    markRevoked(id: string, now: Date): Promise<OrderRecord | null>;
  };
  magicTokens: {
    insert(t: NewMagicToken, now: Date): Promise<void>;
    countRecent(email: string, since: Date): Promise<number>;
    /** Atomic single-use. Null means invalid, expired or already used. */
    consume(tokenHash: string, now: Date): Promise<{ email: string; redirectTo: string } | null>;
    purgeExpired(before: Date): Promise<number>;
  };
  watchlist: {
    list(userId: string): Promise<string[]>;
    add(userId: string, symbols: string[]): Promise<void>;
    remove(userId: string, symbols: string[]): Promise<void>;
  };
  alerts: {
    list(userId: string): Promise<PriceAlert[]>;
    replace(userId: string, alerts: PriceAlert[]): Promise<void>;
  };
  /**
   * Saved chart artifacts — drawings, layouts, indicator templates, settings.
   * One store for all of them, addressed by (kind, key); see migration 006.
   */
  docs: {
    /** Every doc of one kind, oldest key first, for a rail listing. */
    list(userId: string, kind: string): Promise<DocRecord[]>;
    get(userId: string, kind: string, key: string): Promise<DocRecord | null>;
    /**
     * Insert or overwrite, bumping `version`. Rejects a stale write: when
     * `ifVersion` is given and no longer matches the stored row, nothing is
     * written and the CURRENT row comes back so the caller can merge rather than
     * clobber a change another device made.
     */
    put(
      userId: string,
      kind: string,
      key: string,
      data: unknown,
      now: Date,
      ifVersion?: number,
    ): Promise<{ saved: boolean; doc: DocRecord }>;
    remove(userId: string, kind: string, key: string): Promise<void>;
    /** How many docs of a kind this user has — the tier cap is counted on it. */
    count(userId: string, kind: string): Promise<number>;
    /**
     * Owner-and-kind for every stored artifact, for the admin dashboard.
     *
     * Deliberately returns no DATA: the question is how many readers have saved
     * something, and reading their drawings to answer it would be a needless
     * look at private content.
     */
    census(): Promise<{ userId: string; kind: string }[]>;
  };
  /**
   * Time series we record ourselves, for prices no feed publishes history for.
   * Gold is the first: the upstream gives a live snapshot and nothing else.
   */
  series: {
    /**
     * Record points, replacing any already stored for the same instant.
     * Idempotent by (series, t), so re-running the cron on a day it already
     * covered updates that day rather than duplicating it.
     */
    append(series: string, points: SeriesPoint[]): Promise<void>;
    /** Points in ascending time order, newest `limit` when there are more. */
    range(series: string, limit: number): Promise<SeriesPoint[]>;
    /** The oldest instant recorded, so the UI can say when history starts. */
    firstAt(series: string): Promise<number | null>;
  };
  /**
   * The daily brief, kept as it was published.
   *
   * The live brief is composed from feeds that only report "now", so it cannot
   * be reconstructed after the fact — yesterday's page would silently show
   * today's numbers. Each session is therefore snapshotted once and read back
   * verbatim, which is also what makes one URL per trading day honest.
   */
  briefs: {
    /**
     * Store the day's brief, replacing one already stored for that date.
     * Idempotent by `day`, so a cron re-run republishes rather than duplicates.
     */
    put(day: string, data: unknown, now: Date): Promise<void>;
    get(day: string): Promise<BriefRecord | null>;
    /** Newest first, without the documents — for an index and the sitemap. */
    recent(limit: number): Promise<BriefStub[]>;
  };
}

export interface BriefRecord {
  /** `YYYY-MM-DD`, the trading day in Asia/Ho_Chi_Minh. */
  day: string;
  data: unknown;
  createdAt: Date;
  updatedAt: Date;
}

export interface BriefStub {
  day: string;
  updatedAt: Date;
}

export class DbUnavailableError extends Error {}
