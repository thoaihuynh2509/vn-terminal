/**
 * Driver contract suite.
 *
 * Every guarantee below is a property of the PERSISTENCE CONTRACT, not of one
 * driver, so it runs against the file driver always and against postgres when
 * TEST_DATABASE_URL is set. A guarantee proven on only one driver is a
 * guarantee the other driver is free to break.
 *
 * Fixtures are uniquely suffixed per test so the suite is safe against a shared
 * postgres database that is not truncated between tests.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileDb } from "./file.ts";
import type { Db } from "./types.ts";
import type { PriceAlert } from "../alerts/alerts.ts";

/** Independent of the implementation under test — this is the reference hash. */
const sha256hex = (raw: string) => createHash("sha256").update(raw).digest("hex");

const T0 = new Date("2026-09-05T10:00:00.000Z");
const minutes = (n: number) => n * 60_000;
const at = (ms: number) => new Date(T0.getTime() + ms);

function contract(driver: string, makeDb: () => Promise<Db>) {
  let seq = 0;
  const uniq = () => `${driver}${++seq}`;
  const anEmail = () => `test-albert+${uniq()}@example.com`;

  // ── 1. single use, atomically ────────────────────────────────────────────
  test(`[${driver}] exactly one of 20 concurrent consumes returns the token row`, async () => {
    const db = await makeDb();
    const email = anEmail();
    const hash = sha256hex(`raw-${uniq()}`);
    await db.magicTokens.insert(
      { tokenHash: hash, email, redirectTo: "/vi", expiresAt: at(minutes(15)) },
      T0,
    );

    const results = await Promise.all(
      Array.from({ length: 20 }, () => db.magicTokens.consume(hash, at(minutes(1)))),
    );

    const winners = results.filter((r) => r !== null);
    assert.equal(winners.length, 1, "a magic link must be redeemable exactly once");
  });

  test(`[${driver}] a consumed token cannot be consumed a second time`, async () => {
    const db = await makeDb();
    const hash = sha256hex(`raw-${uniq()}`);
    await db.magicTokens.insert(
      { tokenHash: hash, email: anEmail(), redirectTo: "/vi", expiresAt: at(minutes(15)) },
      T0,
    );

    assert.notEqual(await db.magicTokens.consume(hash, at(minutes(1))), null, "the first use must succeed");
    assert.equal(await db.magicTokens.consume(hash, at(minutes(2))), null, "the second use must be refused");
  });

  test(`[${driver}] a successful consume returns the email and redirect it was minted with`, async () => {
    const db = await makeDb();
    const email = anEmail();
    const hash = sha256hex(`raw-${uniq()}`);
    await db.magicTokens.insert(
      { tokenHash: hash, email, redirectTo: "/vi/bieu-do/VNM", expiresAt: at(minutes(15)) },
      T0,
    );

    assert.deepEqual(await db.magicTokens.consume(hash, at(minutes(1))), {
      email,
      redirectTo: "/vi/bieu-do/VNM",
    });
  });

  // ── 2. only the hash is a valid key ──────────────────────────────────────
  test(`[${driver}] the raw token is not a lookup key — only its hash is`, async () => {
    const db = await makeDb();
    const raw = `raw-${uniq()}`;
    await db.magicTokens.insert(
      { tokenHash: sha256hex(raw), email: anEmail(), redirectTo: "/vi", expiresAt: at(minutes(15)) },
      T0,
    );

    assert.equal(await db.magicTokens.consume(raw, at(minutes(1))), null);
  });

  // ── 3. expiry rejects without burning the row ────────────────────────────
  test(`[${driver}] a token past its expiry is refused`, async () => {
    const db = await makeDb();
    const hash = sha256hex(`raw-${uniq()}`);
    await db.magicTokens.insert(
      { tokenHash: hash, email: anEmail(), redirectTo: "/vi", expiresAt: at(minutes(15)) },
      T0,
    );

    assert.equal(await db.magicTokens.consume(hash, at(minutes(16))), null);
  });

  test(`[${driver}] a failed consume does not burn the token`, async () => {
    const db = await makeDb();
    const hash = sha256hex(`raw-${uniq()}`);
    await db.magicTokens.insert(
      { tokenHash: hash, email: anEmail(), redirectTo: "/vi", expiresAt: at(minutes(15)) },
      T0,
    );

    await db.magicTokens.consume(hash, at(minutes(16))); // rejected: expired
    // Same row, now within its window: still redeemable, so consumed_at was never set.
    assert.notEqual(
      await db.magicTokens.consume(hash, at(minutes(5))),
      null,
      "a rejected attempt must not consume the row",
    );
  });

  test(`[${driver}] a token exactly at its expiry instant is refused`, async () => {
    const db = await makeDb();
    const hash = sha256hex(`raw-${uniq()}`);
    const expiresAt = at(minutes(15));
    await db.magicTokens.insert({ tokenHash: hash, email: anEmail(), redirectTo: "/vi", expiresAt }, T0);

    assert.equal(await db.magicTokens.consume(hash, expiresAt), null, "expires_at > now, not >=");
  });

  // ── 4. tier lives on the user row and upsert never resets it ─────────────
  test(`[${driver}] a new user is created on tier free`, async () => {
    const db = await makeDb();
    assert.equal((await db.users.upsertByEmail(anEmail())).tier, "free");
  });

  test(`[${driver}] upserting an existing user does not reset a paid tier`, async () => {
    const db = await makeDb();
    const email = anEmail();
    await db.users.upsertByEmail(email);
    await db.users.setTier(email, "pro");

    assert.equal(
      (await db.users.upsertByEmail(email)).tier,
      "pro",
      "signing in again must not downgrade a paying reader to free",
    );
  });

  test(`[${driver}] upserting an existing user returns the same id`, async () => {
    const db = await makeDb();
    const email = anEmail();
    const first = await db.users.upsertByEmail(email);
    assert.equal((await db.users.upsertByEmail(email)).id, first.id);
  });

  test(`[${driver}] findByEmail returns null for an address that was never seen`, async () => {
    const db = await makeDb();
    assert.equal(await db.users.findByEmail(anEmail()), null);
  });

  // ── 7. email normalisation ───────────────────────────────────────────────
  test(`[${driver}] addresses differing only in case resolve to one user row`, async () => {
    const db = await makeDb();
    const lower = anEmail();
    const mixed = lower.replace("test-albert", "TEST-Albert").replace("example.com", "Example.COM");
    assert.notEqual(mixed, lower, "the fixture must actually differ in case");

    const a = await db.users.upsertByEmail(mixed);
    const b = await db.users.upsertByEmail(lower);
    assert.equal(a.id, b.id, "case must not create a second account for the same person");
  });

  test(`[${driver}] the stored email is lowercased`, async () => {
    const db = await makeDb();
    const lower = anEmail();
    const mixed = lower.replace("test-albert", "TEST-Albert");
    assert.equal((await db.users.upsertByEmail(mixed)).email, lower);
  });

  test(`[${driver}] findByEmail is case-insensitive`, async () => {
    const db = await makeDb();
    const lower = anEmail();
    await db.users.upsertByEmail(lower);
    assert.notEqual(await db.users.findByEmail(lower.toUpperCase()), null);
  });

  // ── 6. watchlist: a set, not a list ──────────────────────────────────────
  test(`[${driver}] adding the same symbol twice stores it once`, async () => {
    const db = await makeDb();
    const { id } = await db.users.upsertByEmail(anEmail());

    await db.watchlist.add(id, ["VNM", "VNM", "FPT"]);
    await db.watchlist.add(id, ["VNM"]);

    assert.deepEqual([...(await db.watchlist.list(id))].sort(), ["FPT", "VNM"]);
  });

  test(`[${driver}] removing a symbol that is not on the list is a no-op`, async () => {
    const db = await makeDb();
    const { id } = await db.users.upsertByEmail(anEmail());
    await db.watchlist.add(id, ["VNM"]);

    await db.watchlist.remove(id, ["HPG"]);
    assert.deepEqual(await db.watchlist.list(id), ["VNM"]);
  });

  test(`[${driver}] removing the same symbol twice is idempotent`, async () => {
    const db = await makeDb();
    const { id } = await db.users.upsertByEmail(anEmail());
    await db.watchlist.add(id, ["VNM", "FPT"]);

    await db.watchlist.remove(id, ["VNM"]);
    await db.watchlist.remove(id, ["VNM"]);
    assert.deepEqual(await db.watchlist.list(id), ["FPT"]);
  });

  test(`[${driver}] adding nothing is a no-op rather than an error`, async () => {
    const db = await makeDb();
    const { id } = await db.users.upsertByEmail(anEmail());
    await db.watchlist.add(id, []);
    assert.deepEqual(await db.watchlist.list(id), []);
  });

  test(`[${driver}] one reader's watchlist is not visible from another's user id`, async () => {
    const db = await makeDb();
    const mine = await db.users.upsertByEmail(anEmail());
    const theirs = await db.users.upsertByEmail(anEmail());
    await db.watchlist.add(mine.id, ["VNM"]);

    assert.deepEqual(await db.watchlist.list(theirs.id), []);
  });

  // ── 8. per-email rate limit ──────────────────────────────────────────────
  test(`[${driver}] countRecent counts only tokens created after the cutoff`, async () => {
    const db = await makeDb();
    const email = anEmail();
    for (const m of [0, 10, 40, 50]) {
      await db.magicTokens.insert(
        { tokenHash: sha256hex(`raw-${uniq()}`), email, redirectTo: "/vi", expiresAt: at(minutes(m + 15)) },
        at(minutes(m)),
      );
    }

    assert.equal(await db.magicTokens.countRecent(email, at(minutes(30))), 2);
  });

  test(`[${driver}] countRecent counts only the address asked about`, async () => {
    const db = await makeDb();
    const mine = anEmail();
    const theirs = anEmail();
    await db.magicTokens.insert(
      { tokenHash: sha256hex(`raw-${uniq()}`), email: mine, redirectTo: "/vi", expiresAt: at(minutes(15)) },
      T0,
    );
    for (let i = 0; i < 3; i++) {
      await db.magicTokens.insert(
        { tokenHash: sha256hex(`raw-${uniq()}`), email: theirs, redirectTo: "/vi", expiresAt: at(minutes(15)) },
        T0,
      );
    }

    assert.equal(
      await db.magicTokens.countRecent(mine, at(-minutes(60))),
      1,
      "another address's requests must not throttle mine",
    );
  });

  test(`[${driver}] countRecent is zero for an address with no tokens`, async () => {
    const db = await makeDb();
    assert.equal(await db.magicTokens.countRecent(anEmail(), at(-minutes(60))), 0);
  });

  test(`[${driver}] countRecent matches the address case-insensitively`, async () => {
    const db = await makeDb();
    const lower = anEmail();
    await db.magicTokens.insert(
      { tokenHash: sha256hex(`raw-${uniq()}`), email: lower.toUpperCase(), redirectTo: "/vi", expiresAt: at(minutes(15)) },
      T0,
    );

    assert.equal(
      await db.magicTokens.countRecent(lower, at(-minutes(60))),
      1,
      "case must not be a way around the per-email limit",
    );
  });

  // ── purgeExpired: housekeeping must never reach a live link ──────────────
  const insertToken = async (db: Db, expiresAtMs: number) => {
    const hash = sha256hex(`raw-${uniq()}`);
    await db.magicTokens.insert(
      { tokenHash: hash, email: anEmail(), redirectTo: "/vi", expiresAt: at(expiresAtMs) },
      T0,
    );
    return hash;
  };

  test(`[${driver}] purgeExpired reports how many rows it removed`, async () => {
    const db = await makeDb();
    // Baseline purge first: purgeExpired is table-global, and the postgres
    // contract shares one database across tests. Clearing already-expired rows
    // from other tests makes the delta this test asserts exact on both drivers.
    await db.magicTokens.purgeExpired(at(minutes(60)));
    await insertToken(db, minutes(5));
    await insertToken(db, minutes(6));
    await insertToken(db, minutes(90));

    assert.equal(await db.magicTokens.purgeExpired(at(minutes(60))), 2);
  });

  test(`[${driver}] purgeExpired removes nothing when nothing has expired`, async () => {
    const db = await makeDb();
    await db.magicTokens.purgeExpired(at(minutes(60))); // baseline, see above
    await insertToken(db, minutes(90));

    assert.equal(await db.magicTokens.purgeExpired(at(minutes(60))), 0);
  });

  test(`[${driver}] purgeExpired leaves an unexpired link redeemable`, async () => {
    const db = await makeDb();
    const stale = await insertToken(db, minutes(5));
    const live = await insertToken(db, minutes(90));

    await db.magicTokens.purgeExpired(at(minutes(60)));

    assert.notEqual(
      await db.magicTokens.consume(live, at(minutes(61))),
      null,
      "housekeeping must not cancel links a reader is still holding",
    );
    assert.equal(await db.magicTokens.consume(stale, at(minutes(61))), null);
  });

  test(`[${driver}] a row expiring exactly at the cutoff is kept`, async () => {
    const db = await makeDb();
    await insertToken(db, minutes(60));

    assert.equal(await db.magicTokens.purgeExpired(at(minutes(60))), 0, "expires_at < before");
  });

  test(`[${driver}] purging does not resurrect a consumed but unexpired token`, async () => {
    const db = await makeDb();
    const hash = await insertToken(db, minutes(90));
    await db.magicTokens.consume(hash, at(minutes(1)));

    await db.magicTokens.purgeExpired(at(minutes(60)));

    assert.equal(
      await db.magicTokens.consume(hash, at(minutes(61))),
      null,
      "a replayed link must stay dead after housekeeping runs",
    );
  });

  test(`[${driver}] purgeExpired on an empty store is a no-op`, async () => {
    const db = await makeDb();
    assert.equal(await db.magicTokens.purgeExpired(at(minutes(60))), 0);
  });

  // ── alerts round-trip ────────────────────────────────────────────────────
  const alert = (over: Partial<PriceAlert> = {}): PriceAlert => ({
    id: "a1",
    symbol: "VNM",
    condition: "above",
    price: 62.5,
    createdAt: Date.parse("2026-09-05T10:00:00.000Z"),
    ...over,
  });
  const byId = (a: PriceAlert, b: PriceAlert) => a.id.localeCompare(b.id);

  test(`[${driver}] an untriggered alert round-trips without gaining a triggeredAt`, async () => {
    const db = await makeDb();
    const { id } = await db.users.upsertByEmail(anEmail());
    const input = alert();

    await db.alerts.replace(id, [input]);

    assert.deepEqual(await db.alerts.list(id), [input]);
  });

  test(`[${driver}] a triggered alert round-trips with its triggeredAt intact`, async () => {
    const db = await makeDb();
    const { id } = await db.users.upsertByEmail(anEmail());
    const input = alert({ triggeredAt: Date.parse("2026-09-05T11:30:00.000Z") });

    await db.alerts.replace(id, [input]);

    assert.deepEqual(await db.alerts.list(id), [input]);
  });

  test(`[${driver}] every alert condition survives storage`, async () => {
    const db = await makeDb();
    const { id } = await db.users.upsertByEmail(anEmail());
    const input: PriceAlert[] = (["above", "below", "cross_up", "cross_down"] as const).map(
      (condition, i) => alert({ id: `c${i}`, condition, price: i + 1 }),
    );

    await db.alerts.replace(id, input);

    assert.deepEqual((await db.alerts.list(id)).sort(byId), input);
  });

  test(`[${driver}] replace overwrites the previous set rather than appending`, async () => {
    const db = await makeDb();
    const { id } = await db.users.upsertByEmail(anEmail());
    await db.alerts.replace(id, [alert({ id: "old" })]);

    await db.alerts.replace(id, [alert({ id: "new" })]);

    assert.deepEqual((await db.alerts.list(id)).map((a) => a.id), ["new"]);
  });

  test(`[${driver}] replacing with an empty array clears the reader's alerts`, async () => {
    const db = await makeDb();
    const { id } = await db.users.upsertByEmail(anEmail());
    await db.alerts.replace(id, [alert()]);

    await db.alerts.replace(id, []);

    assert.deepEqual(await db.alerts.list(id), []);
  });

  test(`[${driver}] a reader with no alerts has an empty list, not an error`, async () => {
    const db = await makeDb();
    const { id } = await db.users.upsertByEmail(anEmail());
    assert.deepEqual(await db.alerts.list(id), []);
  });

  // ── saved chart artifacts (user_docs) ────────────────────────────────────
  // These back every saved drawing, layout and template, so the contract they
  // have to keep is: a write survives, a stale write loses, and one reader's
  // work is never visible to — or overwritten by — another's.

  test(`[${driver}] a doc round-trips and reports version 1`, async () => {
    const db = await makeDb();
    const { id } = await db.users.upsertByEmail(anEmail());

    const { saved, doc } = await db.docs.put(id, "drawings", "VNM", { lines: [1, 2] }, T0);

    assert.equal(saved, true);
    assert.equal(doc.version, 1);
    assert.deepEqual(doc.data, { lines: [1, 2] });
    assert.deepEqual((await db.docs.get(id, "drawings", "VNM"))?.data, { lines: [1, 2] });
  });

  test(`[${driver}] rewriting a doc replaces the data and bumps the version`, async () => {
    const db = await makeDb();
    const { id } = await db.users.upsertByEmail(anEmail());
    await db.docs.put(id, "drawings", "VNM", { lines: [1] }, T0);

    const { doc } = await db.docs.put(id, "drawings", "VNM", { lines: [9] }, at(minutes(1)));

    assert.equal(doc.version, 2, "the version is what a second device compares against");
    assert.deepEqual(doc.data, { lines: [9] });
  });

  test(`[${driver}] a write naming the current version succeeds`, async () => {
    const db = await makeDb();
    const { id } = await db.users.upsertByEmail(anEmail());
    const first = await db.docs.put(id, "settings", "chart", { type: "candle" }, T0);

    const next = await db.docs.put(
      id, "settings", "chart", { type: "line" }, at(minutes(1)), first.doc.version,
    );

    assert.equal(next.saved, true);
    assert.deepEqual(next.doc.data, { type: "line" });
  });

  test(`[${driver}] a stale write is refused and hands back what is stored`, async () => {
    const db = await makeDb();
    const { id } = await db.users.upsertByEmail(anEmail());
    await db.docs.put(id, "settings", "chart", { type: "candle" }, T0); // version 1
    await db.docs.put(id, "settings", "chart", { type: "area" }, at(minutes(1))); // version 2

    // A second device still believes it holds version 1.
    const stale = await db.docs.put(
      id, "settings", "chart", { type: "line" }, at(minutes(2)), 1,
    );

    assert.equal(stale.saved, false, "the older device must not clobber the newer write");
    assert.deepEqual(stale.doc.data, { type: "area" }, "it gets the current row back to merge from");
    assert.deepEqual((await db.docs.get(id, "settings", "chart"))?.data, { type: "area" });
  });

  test(`[${driver}] only one of 10 concurrent writes at the same version wins`, async () => {
    const db = await makeDb();
    const { id } = await db.users.upsertByEmail(anEmail());
    await db.docs.put(id, "drawings", "HPG", { n: 0 }, T0); // version 1

    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        db.docs.put(id, "drawings", "HPG", { n: i + 1 }, at(minutes(1)), 1)),
    );

    assert.equal(
      results.filter((r) => r.saved).length, 1,
      "the guard has to be part of the write, or every racer overwrites the last",
    );
  });

  test(`[${driver}] list returns only the asked-for kind, and count agrees`, async () => {
    const db = await makeDb();
    const { id } = await db.users.upsertByEmail(anEmail());
    await db.docs.put(id, "layout", "a", { g: 1 }, T0);
    await db.docs.put(id, "layout", "b", { g: 2 }, at(minutes(1)));
    await db.docs.put(id, "drawings", "VNM", { lines: [] }, at(minutes(2)));

    const layouts = await db.docs.list(id, "layout");

    assert.deepEqual(layouts.map((d) => d.key), ["a", "b"]);
    assert.equal(await db.docs.count(id, "layout"), 2, "the tier cap is counted on this");
    assert.equal(await db.docs.count(id, "drawings"), 1);
  });

  test(`[${driver}] one reader's docs are invisible to another`, async () => {
    const db = await makeDb();
    const mine = await db.users.upsertByEmail(anEmail());
    const theirs = await db.users.upsertByEmail(anEmail());
    await db.docs.put(mine.id, "drawings", "VNM", { lines: ["mine"] }, T0);

    await db.docs.put(theirs.id, "drawings", "VNM", { lines: ["theirs"] }, T0);

    assert.deepEqual((await db.docs.get(mine.id, "drawings", "VNM"))?.data, { lines: ["mine"] });
    assert.equal(await db.docs.count(theirs.id, "drawings"), 1);
  });

  test(`[${driver}] removing a doc leaves the other keys of that kind`, async () => {
    const db = await makeDb();
    const { id } = await db.users.upsertByEmail(anEmail());
    await db.docs.put(id, "layout", "keep", { g: 1 }, T0);
    await db.docs.put(id, "layout", "drop", { g: 2 }, T0);

    await db.docs.remove(id, "layout", "drop");

    assert.equal(await db.docs.get(id, "layout", "drop"), null);
    assert.equal(await db.docs.count(id, "layout"), 1);
  });

  test(`[${driver}] an absent doc is null and an empty kind lists empty`, async () => {
    const db = await makeDb();
    const { id } = await db.users.upsertByEmail(anEmail());
    assert.equal(await db.docs.get(id, "drawings", "NOPE"), null);
    assert.deepEqual(await db.docs.list(id, "drawings"), []);
    assert.equal(await db.docs.count(id, "drawings"), 0);
  });

  test(`[${driver}] a returned doc is a copy — mutating it cannot edit the store`, async () => {
    const db = await makeDb();
    const { id } = await db.users.upsertByEmail(anEmail());
    await db.docs.put(id, "drawings", "VNM", { lines: [1] }, T0);

    const doc = await db.docs.get(id, "drawings", "VNM");
    (doc!.data as { lines: number[] }).lines.push(999);

    assert.deepEqual((await db.docs.get(id, "drawings", "VNM"))?.data, { lines: [1] });
  });

  test(`[${driver}] replacing one reader's alerts leaves another's alone`, async () => {
    const db = await makeDb();
    const mine = await db.users.upsertByEmail(anEmail());
    const theirs = await db.users.upsertByEmail(anEmail());
    await db.alerts.replace(mine.id, [alert({ id: "mine" })]);
    await db.alerts.replace(theirs.id, [alert({ id: "theirs" })]);

    await db.alerts.replace(mine.id, []);

    assert.deepEqual((await db.alerts.list(theirs.id)).map((a) => a.id), ["theirs"]);
  });

  // ── 7. orders and grant ──────────────────────────────────────────────────
  test(`[${driver}] a fresh account has no expiry`, async () => {
    const db = await makeDb();
    const u = await db.users.upsertByEmail(anEmail());
    assert.equal(u.tier, "free");
    assert.equal(u.tierExpiresAt, null);
  });

  test(`[${driver}] users.all enumerates every account for a cron`, async () => {
    const db = await makeDb();
    const a = await db.users.upsertByEmail(anEmail());
    const b = await db.users.upsertByEmail(anEmail());
    const ids = new Set((await db.users.all()).map((u) => u.id));
    assert.ok(ids.has(a.id) && ids.has(b.id), "both accounts must appear");
  });

  test(`[${driver}] a replayed IPN grants exactly once`, async () => {
    const db = await makeDb();
    const email = anEmail();
    await db.users.upsertByEmail(email);
    const id = `ord-${uniq()}`;
    await db.orders.create({ id, email, tier: "plus", plan: "monthly", amount: 99000, provider: "momo" }, T0);

    const first = await db.orders.markPaid(id, "trans-1", at(minutes(1)));
    const second = await db.orders.markPaid(id, "trans-1", at(minutes(2)));
    assert.ok(first, "first IPN flips the order");
    assert.equal(first?.status, "paid");
    assert.equal(second, null, "a replay must not flip it again");
  });

  test(`[${driver}] grant sets the tier and an expiry in the future`, async () => {
    const db = await makeDb();
    const email = anEmail();
    await db.users.upsertByEmail(email);
    const until = new Date(Date.now() + 30 * 86_400_000);
    const u = await db.users.grant(email, "pro", until);
    assert.equal(u?.tier, "pro");
    assert.ok(u?.tierExpiresAt && u.tierExpiresAt.getTime() > Date.now(), "expiry must be in the future");
  });

  test(`[${driver}] renewing the same tier stacks time rather than resetting it`, async () => {
    const db = await makeDb();
    const email = anEmail();
    await db.users.upsertByEmail(email);
    const thirtyDays = new Date(Date.now() + 30 * 86_400_000);
    const after1 = await db.users.grant(email, "plus", thirtyDays);
    const after2 = await db.users.grant(email, "plus", thirtyDays);
    assert.ok(
      (after2?.tierExpiresAt?.getTime() ?? 0) > (after1?.tierExpiresAt?.getTime() ?? 0),
      "a second month must extend beyond the first",
    );
  });

  test(`[${driver}] a renewal reminder is recorded, and a grant re-arms it`, async () => {
    const db = await makeDb();
    const email = anEmail();
    await db.users.upsertByEmail(email);
    await db.users.grant(email, "plus", new Date(Date.now() + 5 * 86_400_000));
    const marked = await db.users.markRenewalReminded(email, new Date());
    assert.ok(marked?.renewalRemindedAt, "reminder timestamp must be set");
    const renewed = await db.users.grant(email, "plus", new Date(Date.now() + 30 * 86_400_000));
    assert.equal(renewed?.renewalRemindedAt, null, "a renewal must clear the reminder for the new term");
  });

  test(`[${driver}] orders.recent returns newest first`, async () => {
    const db = await makeDb();
    const email = anEmail();
    await db.users.upsertByEmail(email);
    const older = `ord-${uniq()}`;
    const newer = `ord-${uniq()}`;
    await db.orders.create({ id: older, email, tier: "plus", plan: "monthly", amount: 99000, provider: "momo" }, at(0));
    await db.orders.create({ id: newer, email, tier: "pro", plan: "annual", amount: 1990000, provider: "momo" }, at(minutes(1)));
    const rows = await db.orders.recent(10);
    const mine = rows.filter((o) => o.id === older || o.id === newer);
    assert.deepEqual(mine.map((o) => o.id), [newer, older], "most recent first");
  });

  test(`[${driver}] every account gets its own referral code, found by that code`, async () => {
    const db = await makeDb();
    const a = await db.users.upsertByEmail(anEmail());
    const b = await db.users.upsertByEmail(anEmail());
    assert.match(a.referralCode, /^[A-Z0-9]{6,16}$/);
    assert.notEqual(a.referralCode, b.referralCode, "codes must be distinct");
    const found = await db.users.findByReferralCode(a.referralCode);
    assert.equal(found?.email, a.email);
  });

  test(`[${driver}] setReferredBy attributes once, to another account, never self`, async () => {
    const db = await makeDb();
    const referrer = await db.users.upsertByEmail(anEmail());
    const referred = await db.users.upsertByEmail(anEmail());

    const self = await db.users.setReferredBy(referrer.email, referrer.referralCode);
    assert.equal(self?.referredBy, null, "self-referral is refused");

    const ok = await db.users.setReferredBy(referred.email, referrer.referralCode.toLowerCase());
    assert.equal(ok?.referredBy, referrer.referralCode, "code is normalised and stored");

    const again = await db.users.setReferredBy(referred.email, (await db.users.upsertByEmail(anEmail())).referralCode);
    assert.equal(again?.referredBy, referrer.referralCode, "attribution is set once, not overwritten");
  });

  test(`[${driver}] a grant clears the renewal mark but never the referral code`, async () => {
    const db = await makeDb();
    const u = await db.users.upsertByEmail(anEmail());
    const granted = await db.users.grant(u.email, "plus", new Date(Date.now() + 86_400_000));
    assert.equal(granted?.referralCode, u.referralCode, "a purchase must not change the referral code");
    const rewarded = await db.users.markReferralRewarded(u.email, new Date());
    assert.ok(rewarded?.referralRewardedAt, "reward timestamp is recorded");
  });

  test(`[${driver}] a reader can opt out of marketing and a teaser send is recorded`, async () => {
    const db = await makeDb();
    const email = anEmail();
    const u = await db.users.upsertByEmail(email);
    assert.equal(u.marketingOptOut, false, "opted in by default");
    assert.equal(u.teaserSentAt, null);
    const out = await db.users.setMarketingOptOut(email, true);
    assert.equal(out?.marketingOptOut, true);
    const teased = await db.users.markTeaserSent(email, new Date());
    assert.ok(teased?.teaserSentAt, "teaser timestamp recorded");
  });

  test(`[${driver}] dropping to free clears the expiry`, async () => {
    const db = await makeDb();
    const email = anEmail();
    await db.users.upsertByEmail(email);
    await db.users.grant(email, "plus", new Date(Date.now() + 86_400_000));
    const downgraded = await db.users.setTier(email, "free");
    assert.equal(downgraded?.tier, "free");
    assert.equal(downgraded?.tierExpiresAt, null);
  });
}

const fileDir = () => mkdtemp(join(tmpdir(), "vnt-db-test-"));

contract("file", async () => createFileDb(await fileDir()));

// ── 2. the raw token must not reach disk (file driver only) ────────────────
test("[file] the raw token never appears in the persisted state", async () => {
  const dir = await fileDir();
  const db = await createFileDb(dir);
  const raw = "test-raw-token-that-must-never-be-written-to-disk";

  await db.magicTokens.insert(
    {
      tokenHash: sha256hex(raw),
      email: "test-albert@example.com",
      redirectTo: "/vi",
      expiresAt: at(minutes(15)),
    },
    T0,
  );

  const names = await readdir(dir);
  assert.ok(names.length > 0, "the driver must have persisted something to inspect");
  for (const name of names) {
    const contents = await readFile(join(dir, name), "utf8");
    assert.ok(!contents.includes(raw), `${name} contains the raw token`);
  }
});

// ── the file driver must survive a damaged store ──────────────────────────
// The file is written by atomic rename so it cannot be torn by this process,
// but a hand-edited or externally-clobbered dev store is ordinary. Losing dev
// data is acceptable; crashing every request that touches the driver is not.
// The file is planted BEFORE the first createFileDb for the directory, because
// the driver caches parsed state per directory after its first load.
for (const [name, contents] of [
  ["truncated", '{"version":1,"users":[{"id"'],
  ["not json at all", "<!doctype html>"],
  ["empty file", ""],
  // Shape-valid JSON that is not a store. `JSON.parse` accepts all three, so
  // only an explicit shape check keeps them from reaching a `.find` as a
  // TypeError. The realistic source is not a hand edit but a later migration
  // adding a table, which leaves every existing dev store missing that array.
  ["an object with no tables", "{}"],
  ["a bare null", "null"],
] as const) {
  test(`[file] a ${name} store starts clean instead of throwing`, async () => {
    const dir = await fileDir();
    await writeFile(join(dir, "db.json"), contents, "utf8");

    const db = await createFileDb(dir);

    assert.equal(await db.users.findByEmail("test-albert@example.com"), null);
  });

  test(`[file] a ${name} store is writable again afterwards`, async () => {
    const dir = await fileDir();
    await writeFile(join(dir, "db.json"), contents, "utf8");
    const db = await createFileDb(dir);

    const user = await db.users.upsertByEmail("test-albert@example.com");

    assert.equal((await db.users.findByEmail("test-albert@example.com"))?.id, user.id);
  });
}

// The migration case, which the shared table above cannot express: a store
// written before a later migration added a table. `users` is present, so a
// probe that only reads users passes even unfixed — the probe has to touch the
// table that is MISSING. This is the realistic trigger, not a hand edit.
test("[file] a store missing a table added by a later migration starts clean", async () => {
  const dir = await fileDir();
  await writeFile(join(dir, "db.json"), '{"version":1,"users":[],"magicTokens":[]}', "utf8");

  const db = await createFileDb(dir);
  const user = await db.users.upsertByEmail("test-albert@example.com");

  // watchlistItems and alerts are absent from the file; both must still work.
  assert.deepEqual(await db.watchlist.list(user.id), []);
  await db.watchlist.add(user.id, ["VNM"]);
  assert.deepEqual(await db.watchlist.list(user.id), ["VNM"]);
  assert.deepEqual(await db.alerts.list(user.id), []);
});

// The postgres half proves the same contract against real SQL. Without a
// database URL there is nothing to connect to, so it does not register.
const pgUrl = process.env.TEST_DATABASE_URL;
if (pgUrl) {
  contract("postgres", async () => {
    const { createPostgresDb } = await import("./postgres.ts");
    return createPostgresDb(pgUrl);
  });
}
