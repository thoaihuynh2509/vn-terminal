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

export interface NewMagicToken {
  tokenHash: string;
  email: string;
  redirectTo: string;
  expiresAt: Date;
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
}

export class DbUnavailableError extends Error {}
