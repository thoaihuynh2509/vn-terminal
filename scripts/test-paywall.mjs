/**
 * Entitlement integration test.
 *
 * Asserts the paid surface end-to-end: what a tier can reach over HTTP, and
 * that a forged or swapped session cookie buys nothing. Separate from the unit
 * tests because the property that matters is what actually crosses the wire.
 *
 *   AUTH_SECRET=... BASE=http://localhost:3001 node scripts/test-paywall.mjs
 */
import crypto from "node:crypto";

const BASE = process.env.BASE ?? "http://localhost:3001";
const SECRET = process.env.AUTH_SECRET;
if (!SECRET) {
  console.log("SKIPPED — set AUTH_SECRET to the server's signing secret to run this suite.");
  process.exit(0);
}

const enc = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const sign = (p, s = SECRET) => crypto.createHmac("sha256", s).update(p).digest("base64url");
const token = (o, s) => { const p = enc(o); return `${p}.${sign(p, s)}`; };
const now = () => Math.floor(Date.now() / 1000);
const session = (tier) => ({ email: "test.user@example.com", tier, read: [], iat: now() });

const results = [];
const check = (name, pass, detail = "") => results.push({ name, pass: pass ? "PASS" : "FAIL", detail });

async function chart(cookie) {
  const res = await fetch(`${BASE}/vi/bieu-do/VNM`, { headers: cookie ? { Cookie: `vnt_session=${cookie}` } : {} });
  const body = await res.text();
  const main = body.slice(body.indexOf("<main"), body.indexOf("</main>"));
  // Count locks on INDICATOR buttons only. Drawing tools and layout options are
  // separately Pro-gated, so a page-wide 🔒 count made `plus` — which has the
  // full indicator library but not drawings — look like a failure.
  const buttons = main.match(/<button[\s\S]*?<\/button>/g) || [];
  const NAMES = ["SMA20", "SMA50", "EMA20", "BB", "VWAP", "RSI", "MACD", "ATR"];
  const lockedIndicators = buttons.filter(
    (b) => b.includes("🔒") && NAMES.some((n) => b.includes(`>${n}<`) || b.endsWith(`${n}</button>`)),
  ).length;
  return {
    status: res.status,
    locked: lockedIndicators,
    lockedAny: (main.match(/🔒/g) || []).length,
    upsell: /Mở khoá toàn bộ/.test(main),
  };
}
async function ask(cookie, ip) {
  const res = await fetch(`${BASE}/api/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": ip, ...(cookie ? { Cookie: `vnt_session=${cookie}` } : {}) },
    body: JSON.stringify({ question: "VNINDEX?", locale: "vi" }),
  });
  return res.status;
}

const pro = session("pro");
const validPro = token(pro);
const forged = `${enc(pro)}.${sign(enc(pro), "attacker-secret")}`;
const swapped = `${enc(pro)}.${sign(enc(session("free")))}`;

// ── the free surface must genuinely work ────────────────────────────────────
{
  const anon = await chart(null);
  check("anonymous can load a chart at all", anon.status === 200, `status ${anon.status}`);
  check("anonymous sees locked indicators", anon.locked > 0, `${anon.locked} locked`);
  check("anonymous is offered the upgrade", anon.upsell === true);
}

// ── paid indicators ─────────────────────────────────────────────────────────
{
  const free = await chart(token(session("free")));
  check("free tier still has locked indicators", free.locked > 0, `${free.locked} locked`);
  const plus = await chart(token(session("plus")));
  check("plus unlocks the indicator library", plus.locked === 0, `${plus.locked} locked`);
  check("plus is not shown the upsell", plus.upsell === false);
  const proRes = await chart(validPro);
  check("pro unlocks the indicator library", proRes.locked === 0, `${proRes.locked} locked`);
  // Drawings and multi-chart are Pro-only, so plus must still see some locks.
  check("plus still lacks the Pro-only tools", plus.lockedAny > 0, `${plus.lockedAny} pro locks`);
  check("pro has nothing locked anywhere", proRes.lockedAny === 0, `${proRes.lockedAny} locks`);
}

// ── forged sessions buy nothing ─────────────────────────────────────────────
{
  const f = await chart(forged);
  check("forged cookie is demoted to anonymous", f.locked > 0, `${f.locked} locked`);
  const sw = await chart(swapped);
  check("swapped payload is demoted to anonymous", sw.locked > 0, `${sw.locked} locked`);
}

async function bars(cookie, tf) {
  const r = await fetch(`${BASE}/api/bars?symbol=VNM&tf=${tf}`, {
    headers: cookie ? { cookie: `vnt_session=${cookie}` } : {},
  });
  const body = await r.json().catch(() => ({}));
  return { status: r.status, n: Array.isArray(body.data) ? body.data.length : 0 };
}

/** Which interval the rendered page treats as current. */
async function currentTf(cookie, asked) {
  const r = await fetch(`${BASE}/vi/bieu-do/VNM?tf=${asked}`, {
    headers: cookie ? { cookie: `vnt_session=${cookie}` } : {},
  });
  const m = (await r.text()).match(/aria-current="page"[^>]*href="[^"]*[?&]tf=([^"&]+)"/);
  return m ? decodeURIComponent(m[1]) : null;
}


// ── intraday is a paid interval; the gate must hold on BOTH surfaces ────────
// The API check exists because a page-only gate leaves the data endpoint as an
// unlocked side door — anyone can read the JSON the chart is drawn from.
{
  check("intraday: anonymous is refused",     (await bars(null, "5m")).status === 402);
  check("intraday: free tier is refused",     (await bars(token(session("free")), "5m")).status === 402);
  check("intraday: forged cookie is refused", (await bars(forged, "5m")).status === 402);
  check("intraday: swapped payload is refused", (await bars(swapped, "5m")).status === 402);

  const plusBars = await bars(token(session("plus")), "5m");
  check("intraday: plus is served real bars", plusBars.status === 200 && plusBars.n > 50, `${plusBars.n} bars`);
  const proBars = await bars(validPro, "1h");
  check("intraday: pro is served real bars", proBars.status === 200 && proBars.n > 50, `${proBars.n} bars`);

  const daily = await bars(null, "1D");
  check("daily stays open to everyone", daily.status === 200 && daily.n > 50, `${daily.n} bars`);
  const weekly = await bars(token(session("free")), "1W");
  check("weekly stays open to free", weekly.status === 200 && weekly.n > 20, `${weekly.n} bars`);

  // Forcing the URL must degrade to daily, not error and not serve the bars.
  check("free forcing ?tf=5m falls back to daily", (await currentTf(token(session("free")), "5m")) === "1D");
  check("pro forcing ?tf=5m gets 5m", (await currentTf(validPro, "5m")) === "5m");
  check("an unknown interval falls back to daily", (await currentTf(validPro, "99x")) === "1D");
}

// ── custom intervals go through the same gate as the built-in ones ─────────
// A custom id is parsed at request time, so it is exactly the shape that would
// slip past a gate written only against the fixed table.
{
  check("custom intraday: anonymous is refused", (await bars(null, "7m")).status === 402);
  check("custom intraday: free is refused", (await bars(token(session("free")), "7m")).status === 402);
  const proCustom = await bars(validPro, "7m");
  check("custom intraday: pro is served", proCustom.status === 200 && proCustom.n > 50, `${proCustom.n} bars`);

  // A multi-day bar is not intraday and must stay open.
  const multiDay = await bars(token(session("free")), "3D");
  check("a multi-day custom interval stays open to free", multiDay.status === 200 && multiDay.n > 50, `${multiDay.n} bars`);

  // Out-of-range ids must degrade to daily, never fetch a decade of minutes.
  check("an out-of-range custom interval falls back to daily",
    (await currentTf(validPro, "5000m")) === "1D");
  check("a valid custom interval survives the URL", (await currentTf(validPro, "7m")) === "7m");
}

// ── the AI endpoint, the only route whose cost scales with use ──────────────
check("AI: anonymous is refused",       (await ask(null, "60.0.0.1")) === 402);
check("AI: free tier is refused",       (await ask(token(session("free")), "60.0.0.2")) === 402);
check("AI: forged cookie is refused",   (await ask(forged, "60.0.0.3")) === 402);
check("AI: swapped payload is refused", (await ask(swapped, "60.0.0.4")) === 402);
check("AI: plus is served",             (await ask(token(session("plus")), "60.0.0.5")) === 200);
check("AI: pro is served",              (await ask(validPro, "60.0.0.6")) === 200);

// ── pricing page stays honest ───────────────────────────────────────────────
{
  const body = await (await fetch(`${BASE}/vi/goi-dich-vu`)).text();
  check("pricing states billing is not enabled", /chưa được kích hoạt/.test(body));
  const pay = (body.match(/href="[^"]*(checkout|stripe|payment|thanh-toan)[^"]*"/gi) || []).length;
  check("pricing exposes no payment link", pay === 0, `${pay} links`);
}

console.table(results);
const failed = results.filter((r) => r.pass === "FAIL");
if (failed.length) { console.error(`\n${failed.length} FAILURE(S)`); process.exitCode = 1; }
else console.log("\nall entitlement checks passed");
