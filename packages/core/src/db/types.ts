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

export type OrderStatus = "pending" | "paid" | "failed";

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
    /** Creates with tier 'free' when absent; an existing row's tier is untouched. */
    upsertByEmail(email: string): Promise<UserRecord>;
    setTier(email: string, tier: StoredTier): Promise<UserRecord | null>;
    /**
     * Grant a paid tier until `expiresAt`. Extends from the later of now and any
     * live subscription so a renewal adds time rather than resetting it.
     */
    grant(email: string, tier: "plus" | "pro", expiresAt: Date): Promise<UserRecord | null>;
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
     * Idempotent pending→paid. Returns the order ONLY on the call that actually
     * flipped it, so a replayed IPN grants exactly once; null on any later call.
     */
    markPaid(id: string, providerRef: string, now: Date): Promise<OrderRecord | null>;
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
}

export class DbUnavailableError extends Error {}
