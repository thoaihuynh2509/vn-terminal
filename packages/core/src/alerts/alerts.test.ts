import assert from "node:assert/strict";
import test from "node:test";
import {
  shouldFire, evaluate, reset, remove, add, parseAlerts, sanitizeAlerts, serializeAlerts,
  type PriceAlert, type AlertCondition,
} from "./alerts.ts";

const mk = (condition: AlertCondition, price: number, over: Partial<PriceAlert> = {}): PriceAlert => ({
  id: "a1", symbol: "VNM", condition, price, createdAt: 0, ...over,
});

test("level alerts fire whenever price is past the threshold", () => {
  assert.equal(shouldFire(mk("above", 60), 61), true);
  assert.equal(shouldFire(mk("above", 60), 60), true, "at the level counts");
  assert.equal(shouldFire(mk("above", 60), 59), false);
  assert.equal(shouldFire(mk("below", 60), 59), true);
  assert.equal(shouldFire(mk("below", 60), 61), false);
});

test("cross alerts need an actual crossing, not just a level", () => {
  // Already above: a cross_up must NOT fire, which is the whole point of it.
  assert.equal(shouldFire(mk("cross_up", 60), 65, 62), false);
  assert.equal(shouldFire(mk("cross_up", 60), 61, 59), true);
  assert.equal(shouldFire(mk("cross_down", 60), 59, 61), true);
  assert.equal(shouldFire(mk("cross_down", 60), 55, 58), false);
});

test("a cross alert cannot fire without a previous observation", () => {
  assert.equal(shouldFire(mk("cross_up", 60), 61, undefined), false);
});

test("an already-triggered alert does not fire again", () => {
  assert.equal(shouldFire(mk("above", 60, { triggeredAt: 1 }), 99), false);
});

test("evaluate marks and reports only the alerts that fired", () => {
  const alerts = [
    mk("above", 60, { id: "hit" }),
    mk("above", 90, { id: "miss" }),
    mk("above", 10, { id: "other", symbol: "FPT" }),
  ];
  const r = evaluate(alerts, "VNM", 62, 59, 1234);
  assert.deepEqual(r.fired.map((a) => a.id), ["hit"]);
  assert.equal(r.alerts.find((a) => a.id === "hit")?.triggeredAt, 1234);
  assert.equal(r.alerts.find((a) => a.id === "miss")?.triggeredAt, undefined);
});

test("evaluate ignores alerts for other symbols", () => {
  const alerts = [mk("above", 1, { id: "fpt", symbol: "FPT" })];
  assert.deepEqual(evaluate(alerts, "VNM", 999, 0).fired, []);
});

test("symbol matching is case-insensitive on the lookup side", () => {
  const alerts = [mk("above", 60, { symbol: "VNM" })];
  assert.equal(evaluate(alerts, "vnm", 61, 59).fired.length, 1);
});

test("evaluate is pure — the input array is not mutated", () => {
  const alerts = [mk("above", 60)];
  const snapshot = JSON.stringify(alerts);
  evaluate(alerts, "VNM", 99, 1);
  assert.equal(JSON.stringify(alerts), snapshot);
});

test("reset re-arms a fired alert", () => {
  const alerts = [mk("above", 60, { triggeredAt: 5 })];
  assert.equal(reset(alerts, "a1")[0].triggeredAt, undefined);
  assert.equal(shouldFire(reset(alerts, "a1")[0], 61), true);
});

test("the tier ceiling is enforced in the model, not only the UI", () => {
  const two = [mk("above", 1, { id: "x" }), mk("above", 2, { id: "y" })];
  assert.equal(add(two, mk("above", 3, { id: "z" }), 2).length, 2, "over the cap is a no-op");
  assert.equal(add(two, mk("above", 3, { id: "z" }), 5).length, 3);
  assert.equal(add([], mk("above", 1), 0).length, 0, "a zero cap admits nothing");
});

test("remove deletes only the requested alert", () => {
  const two = [mk("above", 1, { id: "x" }), mk("above", 2, { id: "y" })];
  assert.deepEqual(remove(two, "x").map((a) => a.id), ["y"]);
});

test("alerts round-trip through storage", () => {
  const items = [mk("cross_up", 62.5, { id: "r1" })];
  assert.deepEqual(parseAlerts(serializeAlerts(items)), items);
});

test("corrupt storage drops only the bad entries", () => {
  const raw = JSON.stringify([
    { id: "ok", symbol: "VNM", condition: "above", price: 10, createdAt: 0 },
    { id: "bad", symbol: "VNM", condition: "sideways", price: 10, createdAt: 0 },
    { id: "bad2", symbol: "VNM", condition: "above", price: null, createdAt: 0 },
  ]);
  const out = parseAlerts(raw);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, "ok");
  for (const junk of [null, "", "nope", "{}"]) assert.deepEqual(parseAlerts(junk as string | null), []);
});

// ── sanitizeAlerts: one definition of "storable", shared by browser and API ──

test("hostile or malformed entries are dropped, not accepted", () => {
  const cleaned = sanitizeAlerts([
    { id: "ok", symbol: "vnm", condition: "above", price: 50, createdAt: 1 },
    null,
    "nope",
    { id: "", symbol: "VNM", condition: "above", price: 50 },          // no id
    { id: "a", symbol: "TOOLONGSYMBOL", condition: "above", price: 5 }, // bad symbol
    { id: "b", symbol: "VNM", condition: "sideways", price: 5 },        // bad condition
    { id: "c", symbol: "VNM", condition: "above", price: 0 },           // non-positive
    { id: "d", symbol: "VNM", condition: "above", price: -1 },
    { id: "e", symbol: "VNM", condition: "above", price: Number.NaN },
    { id: "f", symbol: "VNM", condition: "above", price: "50" },        // string price
  ]);
  assert.equal(cleaned.length, 1);
  assert.equal(cleaned[0].symbol, "VNM", "symbols are normalised to upper case");
});

test("a non-array body yields no alerts rather than throwing", () => {
  for (const v of [null, undefined, 42, "x", {}]) {
    assert.deepEqual(sanitizeAlerts(v), []);
  }
});

test("duplicate ids collapse — the id is what reset and delete address", () => {
  const cleaned = sanitizeAlerts([
    { id: "same", symbol: "VNM", condition: "above", price: 10, createdAt: 1 },
    { id: "same", symbol: "HPG", condition: "below", price: 20, createdAt: 2 },
  ]);
  assert.equal(cleaned.length, 1);
});

test("a missing createdAt is filled rather than dropping the alert", () => {
  const cleaned = sanitizeAlerts([{ id: "a", symbol: "VNM", condition: "above", price: 10 }]);
  assert.equal(cleaned.length, 1);
  assert.ok(Number.isFinite(cleaned[0].createdAt));
});

test("a triggered alert keeps its timestamp through a round trip", () => {
  const cleaned = sanitizeAlerts([
    { id: "a", symbol: "VNM", condition: "above", price: 10, createdAt: 1, triggeredAt: 99 },
  ]);
  assert.equal(cleaned[0].triggeredAt, 99);
});
