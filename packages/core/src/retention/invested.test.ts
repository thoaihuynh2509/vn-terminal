import test from "node:test";
import assert from "node:assert/strict";
import { INVESTED_KINDS, firedSince, investedStats } from "./invested.ts";

const d = (userId: string, kind: string) => ({ userId, kind });

test("a reader with any saved artifact counts once", () => {
  const s = investedStats([d("a", "drawings"), d("a", "layout"), d("b", "layout")]);
  assert.equal(s.invested, 2);
  assert.equal(s.total, 3);
});

test("settings are not an artifact", () => {
  // Written the first time anyone toggles anything, so counting it would report
  // almost every visitor as invested and make the metric say nothing.
  assert.ok(!(INVESTED_KINDS as readonly string[]).includes("settings"));
  assert.equal(investedStats([d("a", "settings")]).invested, 0);
});

test("artifacts are broken down by kind", () => {
  const s = investedStats([d("a", "drawings"), d("b", "drawings"), d("c", "template")]);
  assert.equal(s.byKind.drawings, 2);
  assert.equal(s.byKind.template, 1);
});

test("no artifacts is zero, not a crash", () => {
  assert.deepEqual(investedStats([]), { invested: 0, byKind: {}, total: 0 });
});

test("alerts fired inside the window are counted", () => {
  const now = Date.UTC(2026, 8, 7);
  const day = 86_400_000;
  const fired = firedSince(
    [{ firedAt: now - day }, { firedAt: now - 30 * day }, { firedAt: null }, {}],
    now, 7,
  );
  assert.equal(fired, 1);
});

test("an alert that never fired is not counted", () => {
  assert.equal(firedSince([{ firedAt: null }, {}], Date.now()), 0);
});
