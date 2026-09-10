/**
 * Driver contract suite.
 *
 * Every guarantee below is a property of the PERSISTENCE CONTRACT, not of one
 * driver, so it runs against the file driver always and against postgres when
 * TEST_DATABASE_URL is set. A guarantee proven on only one driver is a
 * guarantee the other driver is free to break.
 *
 * Fixtures are suffixed with the RUN and the test, so the suite is safe against
 * a shared postgres database that is not truncated between tests — and safe to
 * run twice in a row, which a per-test counter alone is not.
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
  // The RUN is part of the suffix, not just the test.
  //
  // A per-test counter restarts at 1 on every run, so a second run against a
  // persistent database reuses every email and every token hash from the first
  // — and postgres, which has a primary key on token_hash, then fails on a
  // duplicate while the file driver, which has no such constraint, happily
  // keeps both. The header above claimed this suite was safe against a database
  // that is not truncated between tests; until now it was not.
  const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const uniq = () => `${driver}${run}${++seq}`;
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

  test(`[${driver}] every alert kind survives storage`, async () => {
    // The extra columns are provenance: without them a percent alert comes back
    // as a bare number the reader never typed, and an indicator alert loses the
    // fact that it watches RSI rather than the price.
    const db = await makeDb();
    const { id } = await db.users.upsertByEmail(anEmail());
    await db.alerts.replace(id, [
      { id: "plain", symbol: "VNM", condition: "above", price: 70, createdAt: 1 },
      { id: "percent", symbol: "VNM", condition: "above", price: 105, createdAt: 2, kind: "pct", pct: 5, basePrice: 100 },
      { id: "ind", symbol: "VNM", condition: "cross_up", price: 70, createdAt: 3, kind: "indicator", indicator: "rsi", period: 14 },
    ]);

    const back = (await db.alerts.list(id)).sort((a, b) => a.createdAt - b.createdAt);

    assert.equal(back[0].kind, undefined, "a plain price alert stores no kind");
    assert.equal(back[1].kind, "pct");
    assert.equal(back[1].pct, 5);
    assert.equal(back[1].basePrice, 100);
    assert.equal(back[2].kind, "indicator");
    assert.equal(back[2].indicator, "rsi");
    assert.equal(back[2].period, 14);
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
    // Timestamped from NOW, not the fixed fixture clock. `recent` is global by
    // design — it backs the owner's ledger — so orders left by earlier runs all
    // share the fixture timestamp and crowd this run's two out of the window.
    // Real times make this run's orders genuinely the most recent, which is
    // what the assertion is actually about.
    const base = Date.now();
    await db.orders.create({ id: older, email, tier: "plus", plan: "monthly", amount: 99000, provider: "momo" }, new Date(base));
    await db.orders.create({ id: newer, email, tier: "pro", plan: "annual", amount: 1990000, provider: "momo" }, new Date(base + 60_000));
    const rows = await db.orders.recent(50);
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

  // ── new-account signal (A3) ──────────────────────────────────────────────
  test(`[${driver}] the first upsert of an address reports it as created`, async () => {
    const db = await makeDb();
    const email = anEmail();
    assert.equal((await db.users.upsertByEmail(email)).created, true, "a sign-up is a conversion");
    assert.equal((await db.users.upsertByEmail(email)).created, false, "a returning reader is not a new account");
  });

  // ── abandoned checkouts (A5) ─────────────────────────────────────────────
  //
  // Fixed instants far from every other fixture, and each count assertion
  // drains first, so the number is about THIS row and not about pending orders
  // an earlier test left in a shared postgres database.
  const E0 = new Date("2010-01-01T00:00:00.000Z");
  const eAt = (ms: number) => new Date(E0.getTime() + ms);

  test(`[${driver}] a pending order older than the cutoff is failed and counted`, async () => {
    const db = await makeDb();
    const email = anEmail();
    const id = `ord-${uniq()}`;
    await db.orders.expirePending(eAt(minutes(60)));
    await db.orders.create({ id, email, tier: "plus", plan: "monthly", amount: 99000, provider: "momo" }, E0);

    assert.equal(await db.orders.expirePending(eAt(minutes(60))), 1);
    assert.equal((await db.orders.get(id))?.status, "failed");
  });

  test(`[${driver}] a second sweep of the same window expires nothing`, async () => {
    const db = await makeDb();
    const email = anEmail();
    await db.orders.create({ id: `ord-${uniq()}`, email, tier: "plus", plan: "monthly", amount: 99000, provider: "momo" }, E0);
    await db.orders.expirePending(eAt(minutes(60)));

    assert.equal(await db.orders.expirePending(eAt(minutes(60))), 0, "the sweep is idempotent");
  });

  test(`[${driver}] a pending order newer than the cutoff is left alone`, async () => {
    const db = await makeDb();
    const id = `ord-${uniq()}`;
    await db.orders.create({ id, email: anEmail(), tier: "plus", plan: "monthly", amount: 99000, provider: "momo" }, eAt(minutes(120)));

    await db.orders.expirePending(eAt(minutes(60)));
    assert.equal((await db.orders.get(id))?.status, "pending", "the buyer may still be paying");
  });

  test(`[${driver}] an order created exactly at the cutoff is not expired`, async () => {
    const db = await makeDb();
    const id = `ord-${uniq()}`;
    await db.orders.create({ id, email: anEmail(), tier: "plus", plan: "monthly", amount: 99000, provider: "momo" }, eAt(minutes(60)));

    await db.orders.expirePending(eAt(minutes(60)));
    assert.equal((await db.orders.get(id))?.status, "pending", "the boundary is strictly older-than");
  });

  test(`[${driver}] a paid order is never expired, however old it is`, async () => {
    const db = await makeDb();
    const id = `ord-${uniq()}`;
    await db.orders.create({ id, email: anEmail(), tier: "pro", plan: "annual", amount: 1990000, provider: "momo" }, E0);
    await db.orders.markPaid(id, `trans-${uniq()}`, eAt(minutes(1)));

    await db.orders.expirePending(eAt(minutes(60)));
    assert.equal((await db.orders.get(id))?.status, "paid", "a settled sale is history, not an abandonment");
  });

  // ── revoke (A6) ──────────────────────────────────────────────────────────
  test(`[${driver}] a paid order is revoked exactly once`, async () => {
    const db = await makeDb();
    const id = `ord-${uniq()}`;
    await db.orders.create({ id, email: anEmail(), tier: "pro", plan: "monthly", amount: 199000, provider: "momo" }, T0);
    await db.orders.markPaid(id, `trans-${uniq()}`, at(minutes(1)));

    const first = await db.orders.markRevoked(id, at(minutes(2)));
    assert.equal(first?.status, "revoked");
    assert.equal(await db.orders.markRevoked(id, at(minutes(3))), null, "a replayed revoke takes nothing more");
  });

  test(`[${driver}] a revoke records when it happened`, async () => {
    const db = await makeDb();
    const id = `ord-${uniq()}`;
    await db.orders.create({ id, email: anEmail(), tier: "pro", plan: "monthly", amount: 199000, provider: "momo" }, T0);
    await db.orders.markPaid(id, `trans-${uniq()}`, at(minutes(1)));

    await db.orders.markRevoked(id, at(minutes(2)));
    assert.deepEqual((await db.orders.get(id))?.revokedAt, at(minutes(2)));
  });

  test(`[${driver}] a pending order cannot be revoked`, async () => {
    const db = await makeDb();
    const id = `ord-${uniq()}`;
    await db.orders.create({ id, email: anEmail(), tier: "pro", plan: "monthly", amount: 199000, provider: "momo" }, T0);

    assert.equal(await db.orders.markRevoked(id, at(minutes(1))), null, "there is nothing to take back yet");
    assert.equal((await db.orders.get(id))?.status, "pending");
  });

  test(`[${driver}] an IPN replayed after a revoke grants nothing`, async () => {
    const db = await makeDb();
    const id = `ord-${uniq()}`;
    await db.orders.create({ id, email: anEmail(), tier: "pro", plan: "monthly", amount: 199000, provider: "momo" }, T0);
    await db.orders.markPaid(id, `trans-${uniq()}`, at(minutes(1)));
    await db.orders.markRevoked(id, at(minutes(2)));

    assert.equal(await db.orders.markPaid(id, `trans-${uniq()}`, at(minutes(3))), null);
    assert.equal((await db.orders.get(id))?.status, "revoked", "a refund is not undone by the provider");
  });

  test(`[${driver}] an expired order that is paid late is still honoured`, async () => {
    // The sweep only says we stopped waiting. Money that arrives afterwards is
    // still money, so 'failed' remains claimable while 'revoked' never is.
    const db = await makeDb();
    const id = `ord-${uniq()}`;
    await db.orders.create({ id, email: anEmail(), tier: "plus", plan: "monthly", amount: 99000, provider: "momo" }, E0);
    await db.orders.expirePending(eAt(minutes(60)));

    const claimed = await db.orders.markPaid(id, `trans-${uniq()}`, eAt(minutes(90)));
    assert.equal(claimed?.status, "paid");
  });

  // ── retract (A6) ─────────────────────────────────────────────────────────
  //
  // Real-time offsets, not the fixture clock: `grant` stacks from Date.now(),
  // so a term built on T0 would already be in the past. `later` breaks the tie
  // at the exact instant a fully retracted term ends.
  test(`[${driver}] retracting the only term drops the reader to free`, async () => {
    const db = await makeDb();
    const email = anEmail();
    await db.users.upsertByEmail(email);
    await db.users.grant(email, "plus", new Date(Date.now() + 30 * 86_400_000));

    const after = await db.users.retract(email, "plus", 30, new Date(Date.now() + 60_000));
    assert.equal(after?.tier, "free");
    assert.equal(after?.tierExpiresAt, null, "a free row carries no dangling expiry");
  });

  test(`[${driver}] retracting one month of a stacked renewal keeps the tier`, async () => {
    const db = await makeDb();
    const email = anEmail();
    await db.users.upsertByEmail(email);
    const now = new Date();
    await db.users.grant(email, "plus", new Date(now.getTime() + 30 * 86_400_000));
    await db.users.grant(email, "plus", new Date(now.getTime() + 30 * 86_400_000));

    const after = await db.users.retract(email, "plus", 30, now);
    assert.equal(after?.tier, "plus", "the month they still hold is still theirs");
    const daysLeft = (after!.tierExpiresAt!.getTime() - now.getTime()) / 86_400_000;
    assert.ok(Math.abs(daysLeft - 30) < 1, `~30 days remain, got ${daysLeft}`);
  });

  test(`[${driver}] retracting a tier the reader does not hold changes nothing`, async () => {
    const db = await makeDb();
    const email = anEmail();
    await db.users.upsertByEmail(email);
    const granted = await db.users.grant(email, "pro", new Date(Date.now() + 30 * 86_400_000));

    const after = await db.users.retract(email, "plus", 30, new Date());
    assert.equal(after?.tier, "pro");
    assert.deepEqual(after?.tierExpiresAt, granted?.tierExpiresAt);
  });

  test(`[${driver}] retracting never shortens a comped account with no end`, async () => {
    const db = await makeDb();
    const email = anEmail();
    await db.users.upsertByEmail(email);
    await db.users.setTier(email, "plus");

    const after = await db.users.retract(email, "plus", 30, new Date());
    assert.equal(after?.tier, "plus", "a comped tier was never bought, so it cannot be refunded");
    assert.equal(after?.tierExpiresAt, null);
  });

  // ── the settle state machine, exhaustively (A6) ──────────────────────────
  //
  // `markPaid` is the allow-list that decides whether money grants a tier, so
  // every stored status is asserted against it, not just the happy path.
  const anOrder = async (db: Db, createdAt: Date) => {
    const id = `ord-${uniq()}`;
    await db.orders.create({ id, email: anEmail(), tier: "plus", plan: "monthly", amount: 99000, provider: "momo" }, createdAt);
    return id;
  };

  test(`[${driver}] markPaid claims a pending order`, async () => {
    const db = await makeDb();
    const id = await anOrder(db, T0);
    assert.equal((await db.orders.markPaid(id, `trans-${uniq()}`, at(minutes(1))))?.status, "paid");
  });

  test(`[${driver}] markPaid claims an order the sweep gave up on`, async () => {
    const db = await makeDb();
    const id = await anOrder(db, E0);
    await db.orders.expirePending(eAt(minutes(60)));
    assert.equal((await db.orders.get(id))?.status, "failed", "precondition: the sweep failed it");

    assert.equal((await db.orders.markPaid(id, `trans-${uniq()}`, eAt(minutes(90))))?.status, "paid");
  });

  test(`[${driver}] markPaid refuses an order that is already paid`, async () => {
    const db = await makeDb();
    const id = await anOrder(db, T0);
    await db.orders.markPaid(id, `trans-${uniq()}`, at(minutes(1)));
    assert.equal(await db.orders.markPaid(id, `trans-${uniq()}`, at(minutes(2))), null);
  });

  test(`[${driver}] markPaid refuses an order that was revoked`, async () => {
    const db = await makeDb();
    const id = await anOrder(db, T0);
    await db.orders.markPaid(id, `trans-${uniq()}`, at(minutes(1)));
    await db.orders.markRevoked(id, at(minutes(2)));
    assert.equal(await db.orders.markPaid(id, `trans-${uniq()}`, at(minutes(3))), null);
  });

  test(`[${driver}] markPaid refuses an id that does not exist`, async () => {
    const db = await makeDb();
    assert.equal(await db.orders.markPaid(`ord-${uniq()}`, `trans-${uniq()}`, T0), null);
  });

  test(`[${driver}] markRevoked refuses every status but paid`, async () => {
    const db = await makeDb();
    const pending = await anOrder(db, T0);
    const failed = await anOrder(db, E0);
    await db.orders.expirePending(eAt(minutes(60)));

    assert.equal(await db.orders.markRevoked(pending, at(minutes(1))), null, "pending");
    assert.equal(await db.orders.markRevoked(failed, at(minutes(1))), null, "failed");
    assert.equal(await db.orders.markRevoked(`ord-${uniq()}`, at(minutes(1))), null, "absent");
  });

  test(`[${driver}] a late transfer after a sweep still claims the order once`, async () => {
    const db = await makeDb();
    const id = await anOrder(db, E0);
    await db.orders.expirePending(eAt(minutes(60)));

    assert.notEqual(await db.orders.markPaid(id, `trans-${uniq()}`, eAt(minutes(90))), null, "the money arrived");
    assert.equal(await db.orders.markPaid(id, `trans-${uniq()}`, eAt(minutes(91))), null, "and it arrives only once");
  });

  test(`[${driver}] an unrevoked order carries no revocation timestamp`, async () => {
    const db = await makeDb();
    const id = await anOrder(db, T0);
    await db.orders.markPaid(id, `trans-${uniq()}`, at(minutes(1)));
    assert.equal((await db.orders.get(id))?.revokedAt, null);
  });

  test(`[${driver}] the sweep moves the stale pending row and nothing else`, async () => {
    const db = await makeDb();
    const cutoff = new Date("2011-01-01T12:00:00.000Z");
    const before = new Date("2011-01-01T00:00:00.000Z");
    const after = new Date("2011-01-02T00:00:00.000Z");
    await db.orders.expirePending(cutoff); // drain, so the count is about these four

    const stalePending = await anOrder(db, before);
    const freshPending = await anOrder(db, after);
    const stalePaid = await anOrder(db, before);
    const staleRevoked = await anOrder(db, before);
    await db.orders.markPaid(stalePaid, `trans-${uniq()}`, before);
    await db.orders.markPaid(staleRevoked, `trans-${uniq()}`, before);
    await db.orders.markRevoked(staleRevoked, before);

    assert.equal(await db.orders.expirePending(cutoff), 1);
    assert.deepEqual(
      await Promise.all([stalePending, freshPending, stalePaid, staleRevoked].map(async (id) => (await db.orders.get(id))?.status)),
      ["failed", "pending", "paid", "revoked"],
    );
  });

  test(`[${driver}] exactly one of 20 concurrent IPNs claims the order`, async () => {
    const db = await makeDb();
    const id = await anOrder(db, T0);
    const results = await Promise.all(
      Array.from({ length: 20 }, () => db.orders.markPaid(id, `trans-${uniq()}`, at(minutes(1)))),
    );
    assert.equal(results.filter((r) => r !== null).length, 1, "a burst of retries grants one tier, not twenty");
  });

  test(`[${driver}] exactly one of 20 concurrent revokes takes the term back`, async () => {
    const db = await makeDb();
    const id = await anOrder(db, T0);
    await db.orders.markPaid(id, `trans-${uniq()}`, at(minutes(1)));
    const results = await Promise.all(
      Array.from({ length: 20 }, () => db.orders.markRevoked(id, at(minutes(2)))),
    );
    assert.equal(results.filter((r) => r !== null).length, 1, "a double-clicked admin button refunds once");
  });

  // ── retract date maths (A6) ──────────────────────────────────────────────
  test(`[${driver}] retracting more days than remain drops the reader to free`, async () => {
    const db = await makeDb();
    const email = anEmail();
    await db.users.upsertByEmail(email);
    await db.users.grant(email, "plus", new Date(Date.now() + 30 * 86_400_000));

    const after = await db.users.retract(email, "plus", 365, new Date());
    assert.equal(after?.tier, "free", "a year taken off a month cannot leave a negative term");
    assert.equal(after?.tierExpiresAt, null);
  });

  test(`[${driver}] a term that lands exactly on now is over, not a moment of access`, async () => {
    const db = await makeDb();
    const email = anEmail();
    await db.users.upsertByEmail(email);
    const granted = await db.users.grant(email, "plus", new Date(Date.now() + 30 * 86_400_000));
    // The exact tie: retract at the instant the shortened term would end.
    const tie = new Date(granted!.tierExpiresAt!.getTime() - 30 * 86_400_000);

    const after = await db.users.retract(email, "plus", 30, tie);
    assert.equal(after?.tier, "free");
    assert.equal(after?.tierExpiresAt, null);
  });

  test(`[${driver}] retracting an annual order takes back all 365 days`, async () => {
    const db = await makeDb();
    const email = anEmail();
    await db.users.upsertByEmail(email);
    const now = new Date();
    await db.users.grant(email, "pro", new Date(now.getTime() + 365 * 86_400_000));
    await db.users.grant(email, "pro", new Date(now.getTime() + 365 * 86_400_000));

    const after = await db.users.retract(email, "pro", 365, now);
    assert.equal(after?.tier, "pro", "one of the two years is still theirs");
    const daysLeft = (after!.tierExpiresAt!.getTime() - now.getTime()) / 86_400_000;
    assert.ok(Math.abs(daysLeft - 365) < 1, `~365 days remain, got ${daysLeft}`);
  });

  test(`[${driver}] retracting from a term that already lapsed leaves a clean free row`, async () => {
    const db = await makeDb();
    const email = anEmail();
    await db.users.upsertByEmail(email);
    await db.users.grant(email, "plus", new Date(Date.now() - 5 * 86_400_000));

    const after = await db.users.retract(email, "plus", 30, new Date());
    assert.equal(after?.tier, "free");
    assert.equal(after?.tierExpiresAt, null, "no dangling expiry is left behind");
  });

  test(`[${driver}] retracting nothing at all leaves the term exactly as it was`, async () => {
    const db = await makeDb();
    const email = anEmail();
    await db.users.upsertByEmail(email);
    const granted = await db.users.grant(email, "plus", new Date(Date.now() + 30 * 86_400_000));

    const after = await db.users.retract(email, "plus", 0, new Date());
    assert.equal(after?.tier, "plus");
    assert.deepEqual(after?.tierExpiresAt, granted?.tierExpiresAt);
  });

  test(`[${driver}] retracting from an account that does not exist is null, not a crash`, async () => {
    const db = await makeDb();
    assert.equal(await db.users.retract(anEmail(), "plus", 30, new Date()), null);
  });

  test(`[${driver}] retracting is case-insensitive about the address`, async () => {
    const db = await makeDb();
    const email = anEmail();
    await db.users.upsertByEmail(email);
    await db.users.grant(email, "plus", new Date(Date.now() + 30 * 86_400_000));

    const after = await db.users.retract(email.toUpperCase(), "plus", 365, new Date());
    assert.equal(after?.tier, "free", "an address is one account however it is typed");
  });

  test(`[${driver}] retracting never touches the referral ledger`, async () => {
    const db = await makeDb();
    const email = anEmail();
    const u = await db.users.upsertByEmail(email);
    await db.users.markReferralRewarded(email, new Date());
    await db.users.grant(email, "plus", new Date(Date.now() + 30 * 86_400_000));

    const after = await db.users.retract(email, "plus", 365, new Date());
    assert.ok(after?.referralRewardedAt, "un-marking it would let a re-purchase pay twice");
    assert.equal(after?.referralCode, u.referralCode);
  });

  test(`[${driver}] upserting a returning reader reports created false and keeps their id`, async () => {
    const db = await makeDb();
    const email = anEmail();
    const first = await db.users.upsertByEmail(email);
    const again = await db.users.upsertByEmail(email.toUpperCase());
    assert.equal(again.created, false, "a differently-typed address is the same account");
    assert.equal(again.id, first.id);
  });

  // ── recorded series (P2-17) ───────────────────────────────────────────────
  test(`[${driver}] recorded points come back in ascending time`, async () => {
    const db = await makeDb();
    const k = `gold:${uniq()}`;
    await db.series.append(k, [
      { t: 300, o: 3, h: 3, l: 3, c: 3 },
      { t: 100, o: 1, h: 1, l: 1, c: 1 },
      { t: 200, o: 2, h: 2, l: 2, c: 2 },
    ]);
    assert.deepEqual((await db.series.range(k, 100)).map((p) => p.t), [100, 200, 300]);
  });

  test(`[${driver}] re-recording a day updates it rather than duplicating it`, async () => {
    // The cron must be safe to re-run: a retry after a failure cannot be allowed
    // to put two bars on one day.
    const db = await makeDb();
    const k = `gold:${uniq()}`;
    await db.series.append(k, [{ t: 100, o: 1, h: 1, l: 1, c: 1 }]);
    await db.series.append(k, [{ t: 100, o: 9, h: 9, l: 9, c: 9 }]);
    const points = await db.series.range(k, 100);
    assert.equal(points.length, 1);
    assert.equal(points[0].c, 9);
  });

  test(`[${driver}] series are isolated from one another`, async () => {
    const db = await makeDb();
    const a = `gold:${uniq()}`, b = `gold:${uniq()}`;
    await db.series.append(a, [{ t: 100, o: 1, h: 1, l: 1, c: 1 }]);
    await db.series.append(b, [{ t: 100, o: 2, h: 2, l: 2, c: 2 }]);
    assert.equal((await db.series.range(a, 10))[0].c, 1);
    assert.equal((await db.series.range(b, 10))[0].c, 2);
  });

  // ── archived briefs (one URL per trading day) ─────────────────────────────

  test(`[${driver}] a brief is stored and read back as the document it was`, async () => {
    const db = await makeDb();
    const day = "2026-09-10";
    const doc = { v: 1, day, vi: { headline: "Chỉ số tăng" }, visuals: { board: [{ symbol: "VNM" }] } };
    await db.briefs.put(day, doc, T0);

    const row = await db.briefs.get(day);
    assert.ok(row);
    assert.equal(row.day, day);
    // jsonb round-trips as a structure, not as a string.
    assert.deepEqual(row.data, doc);
  });

  test(`[${driver}] a day with no brief is absent, not an error`, async () => {
    const db = await makeDb();
    assert.equal(await db.briefs.get("1999-01-04"), null);
  });

  test(`[${driver}] re-running the cron republishes the day, never duplicates it`, async () => {
    // The cron can fire twice — a retry, a manual trigger. Two rows for one
    // date would mean two pages claiming to be the same session.
    const db = await makeDb();
    const day = "2026-09-11";
    await db.briefs.put(day, { v: 1, headline: "first" }, T0);
    await db.briefs.put(day, { v: 1, headline: "second" }, at(minutes(30)));

    const row = await db.briefs.get(day);
    assert.deepEqual(row?.data, { v: 1, headline: "second" });

    const listed = (await db.briefs.recent(50)).filter((b) => b.day === day);
    assert.equal(listed.length, 1);
  });

  test(`[${driver}] republishing moves updated_at but not the publication date`, async () => {
    const db = await makeDb();
    const day = "2026-09-14";
    await db.briefs.put(day, { v: 1 }, T0);
    const first = await db.briefs.get(day);
    await db.briefs.put(day, { v: 2 }, at(minutes(90)));
    const second = await db.briefs.get(day);

    assert.ok(second);
    // datePublished is a claim about when the edition came out; a re-run hours
    // later must not restate it.
    assert.equal(second.createdAt.getTime(), first?.createdAt.getTime());
    assert.ok(second.updatedAt.getTime() > (first?.updatedAt.getTime() ?? 0));
  });

  test(`[${driver}] recent briefs come back newest first, and honour the limit`, async () => {
    const db = await makeDb();
    const days = ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08"];
    for (const day of days) await db.briefs.put(day, { v: 1, day }, T0);

    const all = (await db.briefs.recent(100)).map((b) => b.day).filter((d) => days.includes(d));
    assert.deepEqual(all, ["2026-10-08", "2026-10-07", "2026-10-06", "2026-10-05"]);

    // The index and the sitemap both take the most recent N.
    const two = await db.briefs.recent(2);
    assert.equal(two.length, 2);
    assert.equal(two[0].day, "2026-10-08");
  });

  test(`[${driver}] a limit keeps the NEWEST points, not the oldest`, async () => {
    // A chart wants the recent past; trimming from the wrong end would show a
    // reader the beginning of history and nothing since.
    const db = await makeDb();
    const k = `gold:${uniq()}`;
    await db.series.append(k, Array.from({ length: 10 }, (_, i) => (
      { t: 100 + i, o: i, h: i, l: i, c: i }
    )));
    const points = await db.series.range(k, 3);
    assert.deepEqual(points.map((p) => p.t), [107, 108, 109]);
  });

  test(`[${driver}] the first recorded instant is what the UI dates history from`, async () => {
    const db = await makeDb();
    const k = `gold:${uniq()}`;
    assert.equal(await db.series.firstAt(k), null, "nothing recorded yet");
    await db.series.append(k, [{ t: 500, o: 1, h: 1, l: 1, c: 1 }, { t: 200, o: 1, h: 1, l: 1, c: 1 }]);
    assert.equal(await db.series.firstAt(k), 200);
  });

  test(`[${driver}] an empty append is a no-op, not an error`, async () => {
    const db = await makeDb();
    const k = `gold:${uniq()}`;
    await db.series.append(k, []);
    assert.deepEqual(await db.series.range(k, 10), []);
  });

  test(`[${driver}] a series nobody has recorded is empty, not missing`, async () => {
    const db = await makeDb();
    assert.deepEqual(await db.series.range(`gold:${uniq()}`, 10), []);
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
