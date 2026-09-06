/**
 * Magic-link route suite.
 *
 * Asserts what actually crosses the wire on /api/auth/magic/*: that a request
 * answers identically for every address (no enumeration), that a link is
 * single-use, that only a form POST can redeem it, and that an unconfigured
 * deployment degrades to 501 instead of 500. None of this is reachable from
 * the unit tests, which never see an HTTP status.
 *
 * The suite owns its servers because the raw token exists in exactly one
 * observable place — the console mail driver's stdout — and a link echoed in a
 * response body would be the very leak these checks exist to forbid. To run it
 * against a server you already have, set BASE and MAGIC_LOG (a file that server
 * is writing its stdout to).
 *
 *   npm run build && node scripts/test-magic.mjs
 */
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

const ROOT = new URL("..", import.meta.url).pathname;
const EXTERNAL = process.env.BASE ?? null;
const LOG_FILE = process.env.MAGIC_LOG ?? null;
const SECRET = process.env.AUTH_SECRET ?? "test-magic-suite-secret-0123456789abcdef";
const PORT = Number(process.env.MAGIC_PORT ?? 3311);

if (!existsSync(`${ROOT}.next/BUILD_ID`)) {
  console.log("SKIPPED — no production build. Run `npm run build` first.");
  process.exit(0);
}
if (EXTERNAL && !LOG_FILE) {
  console.log("SKIPPED — BASE is set but MAGIC_LOG is not; the raw link exists only in the server's stdout.");
  process.exit(0);
}

const results = [];
const check = (name, pass, detail = "") => results.push({ name, pass: pass ? "PASS" : "FAIL", detail });

// ── servers ─────────────────────────────────────────────────────────────────
const children = [];
let captured = "";

function serverEnv(extra) {
  const env = { ...process.env };
  for (const k of ["AUTH_PROVIDER", "DATABASE_URL", "DB_DRIVER", "MAIL_PROVIDER", "NEXT_PUBLIC_SITE_URL"]) delete env[k];
  return { ...env, NODE_ENV: "production", AUTH_SECRET: SECRET, ...extra };
}

async function start(port, extra, capture) {
  const child = spawn("npx", ["next", "start", "-p", String(port)], {
    cwd: ROOT,
    env: serverEnv(extra),
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  const sink = (buf) => {
    if (capture) captured += buf.toString();
  };
  child.stdout.on("data", sink);
  child.stderr.on("data", sink);
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 120; i++) {
    try {
      const res = await fetch(`${base}/api/auth/session`);
      if (res.status === 200) return base;
    } catch {
      /* not listening yet */
    }
    await sleep(500);
  }
  throw new Error(`server on ${port} never became ready`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = () => (EXTERNAL ? readFileSync(LOG_FILE, "utf8") : captured);

/** Every link the console driver has printed for one address, oldest first. */
async function linksFor(email) {
  await sleep(250); // the pipe is read asynchronously; let the write land
  return [...log().matchAll(/\[magic-link\] to=(\S+) (\S+)/g)].filter((m) => m[1] === email).map((m) => m[2]);
}
const tokenOf = (link) => new URL(link).searchParams.get("token");

// ── requests ────────────────────────────────────────────────────────────────
let ipN = 0;
const nextIp = () => `70.0.0.${(ipN++ % 250) + 1}`;

async function request(base, email, body = {}) {
  const res = await fetch(`${base}/api/auth/magic/request`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": nextIp() },
    body: JSON.stringify({ email, locale: "vi", ...body }),
  });
  return { status: res.status, body: await res.text() };
}

async function verify(base, token, { fetchSite = "same-origin", method = "POST" } = {}) {
  // A browser always states where the POST came from; the route refuses one
  // that states neither Sec-Fetch-Site nor Origin, so the default models the
  // form submission the verify page actually makes.
  const headers = { "Content-Type": "application/x-www-form-urlencoded", "Sec-Fetch-Site": fetchSite };
  const res = await fetch(`${base}/api/auth/magic/verify`, {
    method,
    headers,
    body: method === "GET" ? undefined : new URLSearchParams({ token: token ?? "", locale: "vi" }).toString(),
    redirect: "manual",
  });
  const cookies = res.headers.getSetCookie();
  const session = cookies.find((c) => c.startsWith("vnt_session=") && !c.startsWith("vnt_session=;"));
  return { status: res.status, location: res.headers.get("location") ?? "", session: session ?? null };
}

/** The cookie is only a session if it verifies under the server's own secret. */
function readSession(cookie) {
  const value = cookie.slice("vnt_session=".length).split(";")[0];
  const [payload, sig] = decodeURIComponent(value).split(".");
  if (crypto.createHmac("sha256", SECRET).update(payload).digest("base64url") !== sig) return null;
  return JSON.parse(Buffer.from(payload, "base64url").toString());
}

// ── the run ─────────────────────────────────────────────────────────────────
const stamp = Date.now();
const A = `test-albert-${stamp}@example.com`;
const B = `test-albert-b-${stamp}@example.com`;
const C = `test-albert-c-${stamp}@example.com`;
const D = `test-albert-d-${stamp}@example.com`;

try {
  // MAIL_PROVIDER is named explicitly: in production the console driver is
  // never the default, because printing a redeemable link to the log is the
  // leak these checks exist to forbid. NEXT_PUBLIC_SITE_URL likewise — a
  // deployment that cannot say where its own links point does not mail any.
  const base =
    EXTERNAL ??
    (await start(
      PORT,
      {
        AUTH_PROVIDER: "magic",
        DB_DRIVER: "file",
        MAIL_PROVIDER: "console",
        NEXT_PUBLIC_SITE_URL: `http://127.0.0.1:${PORT}`,
      },
      true,
    ));

  // ── a brand-new address gets a link and can redeem it ─────────────────────
  const first = await request(base, A);
  check("request answers 200", first.status === 200, `status ${first.status} ${first.body}`);
  check("request body carries no link", !/token=|https?:\/\//.test(first.body), first.body);

  const linkA = (await linksFor(A))[0];
  check("the console driver mailed exactly one link", (await linksFor(A)).length === 1);

  const redeemed = await verify(base, tokenOf(linkA));
  check("a valid token redirects with 303, not 307", redeemed.status === 303, `status ${redeemed.status}`);
  check("a valid token sets vnt_session", redeemed.session !== null);
  check("the redirect leaves the reader signed in, not at an error",
    !redeemed.location.includes("error=") && redeemed.location.endsWith("/vi"), redeemed.location);
  if (redeemed.session) {
    const s = readSession(redeemed.session);
    check("the session is signed and names the address", s?.email === A, JSON.stringify(s));
    check("a new account is minted at the free tier", s?.tier === "free", s?.tier);
  }

  // ── no enumeration: known, unknown and throttled answer identically ───────
  const known = await request(base, A); // A now has a user row
  const fresh = await request(base, B);
  check("known address answers exactly as a new one",
    known.status === first.status && known.body === first.body, `${known.status} ${known.body}`);
  check("second new address answers exactly as the first",
    fresh.status === first.status && fresh.body === first.body, `${fresh.status} ${fresh.body}`);

  // ── the per-email ceiling is silent ───────────────────────────────────────
  let throttled = null;
  for (let i = 0; i < 6; i++) throttled = await request(base, C);
  const sentToC = (await linksFor(C)).length;
  check("the rolling-hour ceiling stops at 5 links", sentToC === 5, `${sentToC} sent`);
  check("the throttled request still answers 200 and identically",
    throttled.status === first.status && throttled.body === first.body, `${throttled.status} ${throttled.body}`);

  // ── redemption is POST-only, single-use and same-site ─────────────────────
  const getVerify = await fetch(`${base}/api/auth/magic/verify`, { redirect: "manual" });
  check("GET on the verify route is 405 — there is no GET handler", getVerify.status === 405, `status ${getVerify.status}`);

  const garbage = await verify(base, "not-a-real-token");
  check("a garbage token redirects to link_invalid",
    garbage.status === 303 && garbage.location.includes("/vi/dang-nhap") && garbage.location.includes("error=link_invalid"),
    `${garbage.status} ${garbage.location}`);
  check("a garbage token sets no session cookie", garbage.session === null);

  const replay = await verify(base, tokenOf(linkA));
  check("replaying a spent token redirects to link_invalid",
    replay.status === 303 && replay.location.includes("error=link_invalid"), `${replay.status} ${replay.location}`);
  check("replaying a spent token sets no session cookie", replay.session === null);

  await request(base, D);
  const tokenD = tokenOf((await linksFor(D))[0]);
  const crossSite = await verify(base, tokenD, { fetchSite: "cross-site" });
  check("a cross-site POST is refused", crossSite.status === 403, `status ${crossSite.status}`);
  check("the refused cross-site POST set no cookie", crossSite.session === null);
  const afterCross = await verify(base, tokenD);
  check("the refusal happened before consume — the token still works", afterCross.status === 303 && afterCross.session !== null);

  // ── an unconfigured production deployment degrades, never 500s ────────────
  const bare = await start(PORT + 1, {}, false);
  const bareRequest = await request(bare, `test-albert-e-${stamp}@example.com`);
  check("unconfigured: request answers 501, not 500", bareRequest.status === 501, `status ${bareRequest.status}`);
  const bareVerify = await verify(bare, "anything");
  check("unconfigured: verify answers 501, not 500", bareVerify.status === 501, `status ${bareVerify.status}`);
  const barePage = await fetch(`${bare}/vi/dang-nhap`);
  check("unconfigured: the login page still renders", barePage.status === 200, `status ${barePage.status}`);
} finally {
  for (const c of children) c.kill("SIGTERM");
}

console.table(results);
const failed = results.filter((r) => r.pass === "FAIL");
if (failed.length) {
  console.error(`\n${failed.length} FAILURE(S)`);
  process.exit(1);
}
console.log("\nall magic-link checks passed");
process.exit(0);
