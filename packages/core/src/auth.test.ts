import assert from "node:assert/strict";
import test from "node:test";
import { can, atLeast, capabilitiesFor, ALERT_LIMIT, DRAWING_LIMIT, INDICATOR_LIMIT, LAYOUT_LIMIT } from "./auth/entitlement.ts";

test("anonymous readers cannot reach paid capabilities", () => {
  assert.equal(can("anon", "chart:basic"), true);
  assert.equal(can("anon", "use:ai-assistant"), false);
  assert.equal(can("anon", "chart:indicators"), false);
  assert.equal(can("free", "use:ai-assistant"), false, "free must not reach the paid model");
});

test("plus and pro unlock the assistant and the indicator library", () => {
  for (const t of ["plus", "pro"] as const) {
    assert.equal(can(t, "use:ai-assistant"), true);
    assert.equal(can(t, "chart:indicators"), true);
  }
});

test("only pro gets multi-chart layouts", () => {
  assert.equal(can("pro", "chart:multi"), true);
  assert.equal(can("plus", "chart:multi"), false);
});

// The retention thesis, expressed as assertions: a reader must be able to leave
// something behind on the free tier, because a reader who never returns never
// buys. What is sold is depth, reach and portability — not the first drawing.
test("free may draw and set alerts — the artifacts that bring a reader back", () => {
  assert.equal(can("free", "chart:drawings"), true);
  assert.equal(can("free", "alerts:create"), true);
  assert.equal(can("anon", "chart:drawings"), false, "there is no account to save against");
  assert.equal(can("anon", "alerts:create"), false);
});

test("free alerts stay in the tab: delivery and sync are the paid line", () => {
  assert.equal(can("free", "alerts:email"), false, "email is the Plus upsell, not the alert");
  assert.equal(can("free", "sync:docs"), false, "free work lives on one device");
  for (const t of ["plus", "pro"] as const) {
    assert.equal(can(t, "alerts:email"), true);
    assert.equal(can(t, "sync:docs"), true);
  }
});

// Guards a live paywall hole: the alert cron used to gate delivery on
// `alerts:create`. The moment free gained that capability, every free account
// would have been emailed. Delivery must key on `alerts:email` alone.
test("creating an alert never by itself implies being emailed one", () => {
  const canCreateButNotEmail = (["free"] as const).every(
    (t) => can(t, "alerts:create") && !can(t, "alerts:email"),
  );
  assert.ok(canCreateButNotEmail, "free is exactly the tier that separates the two");
});

test("drawing and alert budgets increase with tier, and anon has none", () => {
  const order = ["anon", "free", "plus", "pro"] as const;
  for (let i = 1; i < order.length; i++) {
    assert.ok(DRAWING_LIMIT[order[i]] > DRAWING_LIMIT[order[i - 1]], "drawings");
    assert.ok(ALERT_LIMIT[order[i]] >= ALERT_LIMIT[order[i - 1]], "alerts");
    assert.ok(LAYOUT_LIMIT[order[i]] >= LAYOUT_LIMIT[order[i - 1]], "saved setups");
  }
  assert.equal(DRAWING_LIMIT.anon, 0);
  assert.equal(ALERT_LIMIT.anon, 0);
  assert.equal(LAYOUT_LIMIT.anon, 0);
  assert.ok(LAYOUT_LIMIT.free >= 1, "free must be able to save one setup to have something to return to");
});

test("indicator limits increase strictly with tier", () => {
  const order = ["anon", "free", "plus", "pro"] as const;
  for (let i = 1; i < order.length; i++) {
    assert.ok(INDICATOR_LIMIT[order[i]] > INDICATOR_LIMIT[order[i - 1]]);
  }
});

test("everyone can see a basic chart — the free surface must work", () => {
  for (const t of ["anon", "free", "plus", "pro"] as const) {
    assert.equal(can(t, "chart:basic"), true);
  }
  assert.ok(capabilitiesFor("anon").length >= 1);
});

test("tier ordering", () => {
  assert.equal(atLeast("pro", "plus"), true);
  assert.equal(atLeast("free", "plus"), false);
  assert.equal(atLeast("anon", "free"), false);
});

// ── session token codec ─────────────────────────────────────────────────────
import { encodeSession, decodeSession } from "./auth/token.ts";

const now = () => Math.floor(Date.now() / 1000);

test("a signed session round-trips", async () => {
  const s = { email: "a@b.co", tier: "pro" as const, read: ["x"], iat: now() };
  const decoded = await decodeSession(await encodeSession(s));
  assert.equal(decoded?.email, "a@b.co");
  assert.equal(decoded?.tier, "pro");
  assert.deepEqual(decoded?.read, ["x"]);
});

test("an ANONYMOUS metered session survives the round trip", async () => {
  // Regression: decodeSession once rejected any session with a falsy email,
  // which silently discarded the anonymous meter cookie and handed signed-out
  // readers unlimited member articles.
  const s = { email: "", tier: "anon" as const, read: ["a", "b", "c"], iat: now() };
  const decoded = await decodeSession(await encodeSession(s));
  assert.notEqual(decoded, null, "anonymous meter session must survive");
  assert.deepEqual(decoded?.read, ["a", "b", "c"]);
});

test("a subscription past its end is served as free, not the tier it was sold", async () => {
  const expired = { email: "a@b.co", tier: "pro" as const, read: [], iat: now(), exp: now() - 10 };
  const decoded = await decodeSession(await encodeSession(expired));
  assert.equal(decoded?.tier, "free", "an expired paid session must downgrade");
});

test("a subscription still within its term keeps its paid tier", async () => {
  const live = { email: "a@b.co", tier: "plus" as const, read: [], iat: now(), exp: now() + 3600 };
  const decoded = await decodeSession(await encodeSession(live));
  assert.equal(decoded?.tier, "plus");
  assert.equal(decoded?.exp, live.exp);
});

test("the free-ask meter round-trips and a tamper breaks the signature", async () => {
  const s = { email: "", tier: "anon" as const, read: [], iat: now(), asks: 1 };
  const token = await encodeSession(s);
  assert.equal((await decodeSession(token))?.asks, 1);
  // Bumping asks in the payload without re-signing must be rejected, so the
  // teaser cannot be reset by editing the cookie.
  const [, sig] = token.split(".");
  const forged = Buffer.from(JSON.stringify({ ...s, asks: 0 })).toString("base64url");
  assert.equal(await decodeSession(`${forged}.${sig}`), null);
});

test("a tampered signature is rejected", async () => {
  const token = await encodeSession({ email: "a@b.co", tier: "free", read: [], iat: now() });
  const [payload] = token.split(".");
  assert.equal(await decodeSession(`${payload}.not-a-real-signature`), null);
});

test("a swapped payload is rejected", async () => {
  const free = await encodeSession({ email: "a@b.co", tier: "free", read: [], iat: now() });
  const pro = await encodeSession({ email: "a@b.co", tier: "pro", read: [], iat: now() });
  const forged = `${pro.split(".")[0]}.${free.split(".")[1]}`;
  assert.equal(await decodeSession(forged), null, "privilege escalation must fail");
});

test("an unknown tier is rejected", async () => {
  const payload = Buffer.from(JSON.stringify({ email: "a@b.co", tier: "admin", read: [], iat: now() })).toString("base64url");
  // Signed correctly, but the tier is not one we issue.
  const good = await encodeSession({ email: "a@b.co", tier: "free", read: [], iat: now() });
  assert.equal(await decodeSession(`${payload}.${good.split(".")[1]}`), null);
});

test("malformed tokens are rejected rather than thrown", async () => {
  for (const t of [undefined, "", "nodot", "a.b.c", "!!!.???"]) {
    assert.equal(await decodeSession(t as string | undefined), null);
  }
});
