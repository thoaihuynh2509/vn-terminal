import assert from "node:assert/strict";
import test from "node:test";
import { PRICES, annualSavingPct, expiryFrom, isPaidTier, isPlan, priceFor } from "./plans.ts";

test("every paid tier has a monthly and an annual price, both whole VND > 0", () => {
  for (const tier of ["plus", "pro"] as const) {
    for (const plan of ["monthly", "annual"] as const) {
      const p = priceFor(tier, plan);
      assert.ok(Number.isInteger(p.amount) && p.amount > 0, `${tier} ${plan} amount`);
      assert.ok(Number.isInteger(p.days) && p.days > 0, `${tier} ${plan} days`);
    }
  }
});

test("annual is cheaper per day than monthly — otherwise the annual plan is a trap", () => {
  for (const tier of ["plus", "pro"] as const) {
    const m = PRICES[tier].monthly;
    const a = PRICES[tier].annual;
    assert.ok(a.amount / a.days < m.amount / m.days, `${tier}: annual/day must beat monthly/day`);
  }
});

test("annual saving is a sane whole percent", () => {
  for (const tier of ["plus", "pro"] as const) {
    const pct = annualSavingPct(tier);
    assert.ok(Number.isInteger(pct) && pct > 0 && pct < 100, `${tier}: ${pct}%`);
  }
});

test("expiry is now + the plan's days", () => {
  const now = new Date("2026-01-01T00:00:00Z");
  const exp = expiryFrom(now, "monthly", "plus");
  assert.equal(exp.getTime() - now.getTime(), 30 * 86_400_000);
  const yr = expiryFrom(now, "annual", "pro");
  assert.equal(yr.getTime() - now.getTime(), 365 * 86_400_000);
});

test("guards reject anything that is not a real tier or plan", () => {
  assert.ok(isPaidTier("plus") && isPaidTier("pro"));
  assert.ok(!isPaidTier("free") && !isPaidTier("anon") && !isPaidTier("admin"));
  assert.ok(isPlan("monthly") && isPlan("annual"));
  assert.ok(!isPlan("weekly") && !isPlan(""));
});
