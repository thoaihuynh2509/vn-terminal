/**
 * Minimal Chrome DevTools Protocol driver — no npm dependencies.
 * Used to screenshot the app in both colour schemes and to exercise the
 * interactive controls (sort, theme toggle, watchlist, chart crosshair).
 *
 *   node scripts/cdp.mjs shots   → write screenshots
 *   node scripts/cdp.mjs actions → run the interaction suite
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import nodeCrypto from "node:crypto";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9333;
const BASE = process.env.BASE ?? "http://localhost:3210";
const OUT = process.env.OUT ?? "/tmp/shots";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launch() {
  const proc = spawn(CHROME, [
    "--headless=new", `--remote-debugging-port=${PORT}`, "--disable-gpu",
    "--hide-scrollbars", "--no-first-run", "--force-color-profile=srgb",
    "--user-data-dir=/tmp/cdp-profile", "about:blank",
  ], { stdio: "ignore" });
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) return proc;
    } catch { /* not up yet */ }
    await sleep(250);
  }
  throw new Error("chrome did not start");
}

class Session {
  #ws; #id = 0; #pending = new Map();
  static async open() {
    const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" })).json();
    const s = new Session();
    s.#ws = new WebSocket(t.webSocketDebuggerUrl);
    await new Promise((res, rej) => { s.#ws.onopen = res; s.#ws.onerror = rej; });
    s.#ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      const p = s.#pending.get(m.id);
      if (p) {
        s.#pending.delete(m.id);
        if (m.error) p.rej(new Error(m.error.message));
        else p.res(m.result);
      }
    };
    s.targetId = t.id;
    return s;
  }
  /**
   * Every command is bounded. Without a timeout one CDP call that never gets a
   * reply — `Input.dispatchMouseEvent` into a page with a non-passive wheel
   * handler is the one that bit us — hangs the entire suite forever, with no
   * output and no way to tell which step stalled. A rejection at least names it.
   */
  send(method, params = {}, timeoutMs = 15000) {
    const id = ++this.#id;
    this.#ws.send(JSON.stringify({ id, method, params }));
    // A wheel dispatch into the chart's non-passive handler frequently never
    // gets acknowledged, even though the page does receive the event. Rejecting
    // there would fail a transport detail rather than the behaviour under test,
    // so that one case resolves and lets the assertion be the judge.
    const tolerate = method === "Input.dispatchMouseEvent" && params.type === "mouseWheel";
    return new Promise((res, rej) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        if (tolerate) return res({});
        rej(new Error(`CDP timeout after ${timeoutMs}ms: ${method}`));
      }, timeoutMs);
      this.#pending.set(id, {
        res: (v) => { clearTimeout(timer); res(v); },
        rej: (e) => { clearTimeout(timer); rej(e); },
      });
    });
  }
  /** Resolve when `expr` returns truthy, or throw after `timeoutMs`. */
  async waitFor(expr, { timeoutMs = 20000, every = 200 } = {}) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const v = await this.evaluate(expr);
      if (v) return v;
      if (Date.now() > deadline) return null;
      await sleep(every);
    }
  }
  async evaluate(expr) {
    const r = await this.send("Runtime.evaluate", {
      expression: expr, returnByValue: true, awaitPromise: true,
    });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? "eval failed");
    return r.result.value;
  }
  async goto(url, { scheme = "light", width = 1440, height = 1200 } = {}) {
    await this.send("Emulation.setDeviceMetricsOverride", {
      width, height, deviceScaleFactor: 2, mobile: width < 500,
    });
    await this.send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-color-scheme", value: scheme }],
    });
    await this.send("Page.enable");
    await this.send("Page.navigate", { url });
    // Wait for the app shell plus a beat for client hydration.
    for (let i = 0; i < 80; i++) {
      await sleep(150);
      const ready = await this.evaluate("document.readyState === 'complete' && !!document.querySelector('main')");
      if (ready) break;
    }
    await sleep(700);
  }
  async shot(name, fullPage = true) {
    mkdirSync(OUT, { recursive: true });
    const { data } = await this.send("Page.captureScreenshot", {
      format: "png", captureBeyondViewport: fullPage,
    });
    writeFileSync(`${OUT}/${name}.png`, Buffer.from(data, "base64"));
    return `${OUT}/${name}.png`;
  }
  close() { try { this.#ws.close(); } catch {} }
}

const proc = await launch();
try {
  const mode = process.argv[2] ?? "shots";
  const s = await Session.open();

  if (mode === "shots") {
    // The profile dir persists between runs; a leftover theme=dark would
    // override the emulated colour scheme and silently mislabel every shot.
    await s.goto(BASE + "/vi", { scheme: "light" });
    await s.evaluate("localStorage.clear()");

    const pages = [
      ["home", "/vi", 1440, 1400],
      ["terminal", "/vi/bieu-do/VNM", 1440, 1300],
      ["stocks", "/vi/chung-khoan", 1440, 1200],
      ["gold", "/vi/vang", 1440, 1300],
      ["crypto", "/vi/crypto", 1440, 1300],
      ["heatmap", "/vi/ban-do-nhiet", 1440, 900],
      ["brief", "/vi/ban-tin", 1440, 1200],
      ["pricing", "/vi/goi-dich-vu", 1440, 1100],
      ["ask", "/vi/hoi-ai", 1440, 900],
      ["home-en", "/en", 1440, 1400],
    ];
    for (const [name, path, w, h] of pages) {
      for (const scheme of ["light", "dark"]) {
        await s.goto(BASE + path, { scheme, width: w, height: h });
        await s.shot(`${name}-${scheme}`);
      }
    }
    // The interval menu only exists while open, so it needs its own capture.
    for (const scheme of ["light", "dark"]) {
      await s.goto(BASE + "/vi/bieu-do/VNM?tf=5m", { scheme, width: 1440, height: 1000 });
      await s.evaluate(`document.querySelector('button[aria-haspopup="menu"]')?.click()`);
      await sleep(400);
      await s.shot(`timeframes-${scheme}`);
    }
    await s.goto(BASE + "/vi/bieu-do/VNM?tf=5m", { scheme: "light", width: 1440, height: 1000 });
    await s.shot("terminal-intraday-light");

    // Mid-typing, so the shortcut read-out is visible in the capture.
    await s.goto(BASE + "/vi/bieu-do/VNM?tf=1D", { scheme: "light", width: 1440, height: 620 });
    for (const k of ["1", "5"]) {
      await s.send("Input.dispatchKeyEvent", { type: "keyDown", key: k, text: k });
      await s.send("Input.dispatchKeyEvent", { type: "keyUp", key: k });
    }
    await sleep(250);
    await s.shot("tf-typing");

    // A Fibonacci retracement placed on the chart, in both schemes.
    for (const scheme of ["light", "dark"]) {
      await s.goto(BASE + "/vi/bieu-do/VNM?tf=1D", { scheme, width: 1440, height: 760 });
      await s.evaluate("localStorage.removeItem('drawings:VNM')");
      await s.goto(BASE + "/vi/bieu-do/VNM?tf=1D", { scheme, width: 1440, height: 760 });
      await s.evaluate(`document.querySelector('[aria-label="Fibonacci thoái lui"]')?.click()`);
      await sleep(200);
      const r = JSON.parse(await s.evaluate(`(() => { const b = document.querySelector('svg[role=img]').getBoundingClientRect();
        return JSON.stringify({ l: b.left, t: b.top, w: b.width, h: b.height }); })()`));
      for (const [fx, fy] of [[0.28, 0.82], [0.66, 0.18]]) {
        const x = r.l + r.w * fx, y = r.t + r.h * fy;
        await s.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
        await s.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
        await sleep(280);
      }
      await sleep(400);
      await s.shot(`fib-${scheme}`);
    }

    // A parallel channel drawn on the chart.
    for (const scheme of ["light", "dark"]) {
      await s.goto(BASE + "/vi/bieu-do/VNM?tf=1D", { scheme, width: 1440, height: 760 });
      await s.evaluate("localStorage.removeItem('drawings:VNM')");
      await s.goto(BASE + "/vi/bieu-do/VNM?tf=1D", { scheme, width: 1440, height: 760 });
      await s.evaluate(`document.querySelector('[aria-label="Kênh xu hướng song song"]')?.click()`);
      await sleep(200);
      const r = JSON.parse(await s.evaluate(`(() => { const b = document.querySelector('svg[role=img]').getBoundingClientRect();
        return JSON.stringify({ l: b.left, t: b.top, w: b.width, h: b.height }); })()`));
      for (const [fx, fy] of [[0.12, 0.35], [0.92, 0.72], [0.5, 0.86]]) {
        const x = r.l + r.w * fx, y = r.t + r.h * fy;
        await s.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
        await s.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
        await sleep(260);
      }
      await sleep(400);
      await s.shot(`channel-${scheme}`);
    }

    await s.goto(BASE + "/vi", { scheme: "light", width: 390, height: 1500 });
    await s.shot("home-mobile");
    await s.goto(BASE + "/vi/bieu-do/VNM?tf=1h", { scheme: "light", width: 390, height: 1100 });
    await s.shot("terminal-mobile");
    await s.goto(BASE + "/vi/chung-khoan", { scheme: "light", width: 390, height: 900 });
    await s.shot("stocks-mobile");
    console.log("screenshots written to", OUT);
  }

  if (mode === "perf") {
    // Chart interaction cost, measured rather than felt.
    //
    // `Performance.getMetrics` gives cumulative renderer timings, so the delta
    // across a scripted interaction is a comparable number between runs. Frame
    // deltas are sampled inside the page because dropped frames are what the
    // reader actually perceives as jank.
    const secret = process.env.AUTH_SECRET;
    if (secret) {
      const payload = Buffer.from(JSON.stringify({
        email: "test.user@example.com", tier: "pro", read: [], iat: Math.floor(Date.now() / 1000),
      })).toString("base64url");
      const sig = nodeCrypto.createHmac("sha256", secret).update(payload).digest("base64url");
      await s.send("Network.enable");
      await s.send("Network.setCookie", {
        name: "vnt_session", value: `${payload}.${sig}`,
        domain: new URL(BASE).hostname, path: "/", httpOnly: true, sameSite: "Lax",
      });
    }
    await s.send("Performance.enable");

    const INDICATORS = ["SMA50", "EMA20", "BB", "VWAP", "RSI", "MACD", "ADX"];
    await s.goto(BASE + "/vi/bieu-do/VNM?tf=1D", { scheme: "light", width: 1440, height: 900 });
    for (const label of INDICATORS) {
      await s.evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '${label}')?.click()`);
      await sleep(120);
    }
    await sleep(600);
    const activeCount = await s.evaluate(`document.querySelectorAll('svg[role=img]').length`);

    const metric = async (name) => {
      const { metrics } = await s.send("Performance.getMetrics");
      return metrics.find((m) => m.name === name)?.value ?? 0;
    };

    const startSampler = () => s.evaluate(`(() => {
      window.__frames = [];
      let last = performance.now();
      window.__stop = false;
      const tick = (t) => {
        window.__frames.push(t - last); last = t;
        if (!window.__stop) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      return true;
    })()`);
    const stopSampler = () => s.evaluate(`(() => {
      window.__stop = true;
      const f = (window.__frames || []).slice(2);
      if (!f.length) return JSON.stringify({ frames: 0 });
      const sorted = [...f].sort((a, b) => a - b);
      return JSON.stringify({
        frames: f.length,
        median: +sorted[Math.floor(sorted.length / 2)].toFixed(1),
        p95: +sorted[Math.floor(sorted.length * 0.95)].toFixed(1),
        worst: +Math.max(...f).toFixed(1),
        dropped: f.filter((d) => d > 32).length,
      });
    })()`);

    const box = JSON.parse(await s.evaluate(`(() => { const r = document.querySelector('svg[role=img]').getBoundingClientRect();
      return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width }); })()`));

    // Where the time actually goes. Guessing at hot spots wastes a fix; a CPU
    // profile names them.
    const profile = async (action) => {
      await s.send("Profiler.enable");
      await s.send("Profiler.setSamplingInterval", { interval: 100 });
      await s.send("Profiler.start");
      await action();
      const { profile: prof } = await s.send("Profiler.stop");
      const self = new Map();
      const byId = new Map(prof.nodes.map((n) => [n.id, n]));
      for (let i = 0; i < (prof.samples || []).length; i++) {
        const n = byId.get(prof.samples[i]);
        if (!n) continue;
        const f = n.callFrame;
        const where = f.url ? f.url.split("/").slice(-1)[0] : "(native)";
        const key = `${f.functionName || "(anonymous)"}  ${where}:${f.lineNumber + 1}`;
        const dt = i > 0 ? prof.timeDeltas[i] / 1000 : 0;
        self.set(key, (self.get(key) || 0) + dt);
      }
      return [...self.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 14)
        .map(([fn, ms]) => ({ "self ms": +ms.toFixed(1), fn }));
    };

    const rows = [];
    const run = async (name, action) => {
      await sleep(400);
      const t0 = await metric("ScriptDuration");
      const l0 = await metric("LayoutDuration");
      await startSampler();
      const wall0 = Date.now();
      await action();
      const wall = Date.now() - wall0;
      const stats = JSON.parse(await stopSampler());
      const script = ((await metric("ScriptDuration")) - t0) * 1000;
      const layout = ((await metric("LayoutDuration")) - l0) * 1000;
      rows.push({
        interaction: name,
        "script ms": +script.toFixed(0),
        "layout ms": +layout.toFixed(0),
        "median frame": stats.median ?? 0,
        "p95 frame": stats.p95 ?? 0,
        "worst frame": stats.worst ?? 0,
        "dropped (>32ms)": stats.dropped ?? 0,
        "wall ms": wall,
      });
    };

    await run("drag-pan (40 moves)", async () => {
      await s.send("Input.dispatchMouseEvent", { type: "mousePressed", x: box.x, y: box.y, button: "left", clickCount: 1, buttons: 1 });
      for (let i = 1; i <= 40; i++) {
        await s.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: box.x + i * 6, y: box.y, button: "left", buttons: 1 });
      }
      await s.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: box.x + 240, y: box.y, button: "left", clickCount: 1, buttons: 0 });
      await sleep(500);
    });

    await run("wheel-zoom (20 notches)", async () => {
      for (let i = 0; i < 20; i++) {
        await s.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: box.x, y: box.y, deltaX: 0, deltaY: i < 10 ? -120 : 120 });
      }
      await sleep(500);
    });

    await run("hover-sweep (60 moves)", async () => {
      for (let i = 0; i < 60; i++) {
        await s.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: box.x - box.w / 3 + i * 6, y: box.y });
      }
      await sleep(500);
    });

    console.log(`panes rendered: ${activeCount}`);
    console.table(rows);

    console.log("\nCPU profile — drag-pan, hottest self time:");
    console.table(await profile(async () => {
      await s.send("Input.dispatchMouseEvent", { type: "mousePressed", x: box.x, y: box.y, button: "left", clickCount: 1, buttons: 1 });
      for (let i = 1; i <= 40; i++) {
        await s.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: box.x + i * 6, y: box.y, button: "left", buttons: 1 });
      }
      await s.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: box.x + 240, y: box.y, button: "left", clickCount: 1, buttons: 0 });
      await sleep(400);
    }));
  }

  audit: if (mode === "audit") {
    const rows = [];
    const PAGES = ["/vi", "/vi/bieu-do/VNM", "/vi/chung-khoan", "/vi/chung-khoan/VNM", "/vi/vang",
      "/vi/crypto", "/vi/ban-do-nhiet", "/vi/ban-tin", "/vi/goi-dich-vu", "/vi/hoi-ai",
      "/vi/theo-doi", "/vi/dang-nhap", "/en", "/en/chart/VNM", "/en/pricing"];
    // A dev server that is not running does not fail the audit — Chrome serves
    // its own error page, which is valid HTML with one h1 and a `lang`, so the
    // run reports plausible-looking findings for a page it never loaded. Prove
    // the app answered before auditing anything.
    await s.goto(BASE + PAGES[0], { scheme: "light" });
    const reachable = await s.evaluate(
      `!!document.querySelector('header') || !!document.querySelector('main#main')`);
    if (!reachable) {
      console.error(`AUDIT ABORTED: ${BASE} did not serve the app — start the dev server on its port.`);
      process.exitCode = 1;
      break audit;
    }

    for (const path of PAGES) {
      await s.goto(BASE + path, { scheme: "light" });
      const r = await s.evaluate(`(() => {
        const q = (sel) => [...document.querySelectorAll(sel)];
        const name = (el) =>
          (el.getAttribute('aria-label') || el.textContent || el.getAttribute('title') || '').trim();
        const headings = q('h1,h2,h3').map(h => +h.tagName[1]);
        let skips = 0;
        for (let i = 1; i < headings.length; i++) if (headings[i] - headings[i-1] > 1) skips++;
        return {
          lang: document.documentElement.lang,
          h1: q('h1').length,
          headingSkips: skips,
          unnamedButtons: q('button').filter(b => !name(b)).length,
          unnamedLinks: q('a').filter(a => !name(a)).length,
          imgNoAlt: q('img').filter(i => !i.hasAttribute('alt')).length,
          tablesNoCaption: q('table').filter(t => !t.querySelector('caption')).length,
          positiveTabindex: q('[tabindex]').filter(e => +e.getAttribute('tabindex') > 0).length,
          svgNoLabel: q('svg[role=img]').filter(sv => !name(sv)).length,
          bodyOverflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        };
      })()`);
      rows.push({ page: path, ...r });
    }
    console.table(rows);
    const bad = rows.filter(r =>
      r.h1 !== 1 || r.headingSkips || r.unnamedButtons || r.unnamedLinks ||
      r.imgNoAlt || r.tablesNoCaption || r.positiveTabindex || r.svgNoLabel ||
      r.bodyOverflowX || !r.lang);
    if (bad.length) { console.error("A11Y ISSUES on:", bad.map(b => b.page).join(", ")); process.exitCode = 1; }
    else console.log("all accessibility checks passed");
  }

  if (mode === "actions") {
    const results = [];
    // Streamed, not just collected: the summary table only prints after the last
    // check, so a step that stalls leaves no way to tell which one it was — the
    // whole run just looks hung. One line per check makes the suite debuggable
    // and shows a failure the moment it happens.
    const check = (name, pass, detail = "") => {
      const row = { name, pass: pass ? "PASS" : "FAIL", detail };
      results.push(row);
      console.log(`  ${row.pass === "PASS" ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
    };

    // Hermetic start — the Chrome profile dir persists between runs. The
    // watchlist checks below assert the anonymous round trip, so the session
    // cookie has to be gone by intent, not because it expired with the browser.
    await s.goto(BASE + "/vi", { scheme: "light" });
    await s.evaluate("localStorage.clear()");
    await s.send("Network.enable");
    await s.send("Network.clearBrowserCookies");

    // ── theme toggle ──────────────────────────────────────────────
    await s.goto(BASE + "/vi", { scheme: "light" });
    const before = await s.evaluate("getComputedStyle(document.body).backgroundColor");
    await s.evaluate(`document.querySelector('header button[aria-label*="giao diện"]').click()`);
    await sleep(300);
    const themeAttr = await s.evaluate("document.documentElement.getAttribute('data-theme')");
    const after = await s.evaluate("getComputedStyle(document.body).backgroundColor");
    check("theme toggle flips light→dark on first press", themeAttr === "dark" && before !== after, `${before} → ${after}`);
    const persisted = await s.evaluate("localStorage.getItem('theme')");
    check("theme persists to localStorage", persisted === "dark", String(persisted));

    // ── language switch keeps the section ─────────────────────────
    await s.goto(BASE + "/vi/chung-khoan", { scheme: "light" });
    const enHref = await s.evaluate(`document.querySelector('header a[aria-label]')?.getAttribute('href')`);
    check("language switch translates the segment", enHref === "/en/stocks", String(enHref));

    // ── sortable board ────────────────────────────────────────────
    await s.goto(BASE + "/vi/chung-khoan", { scheme: "light" });
    const firstBefore = await s.evaluate(`document.querySelector('tbody tr td:nth-child(2) a')?.textContent`);
    await s.evaluate(`[...document.querySelectorAll('thead th button')].find(b=>/Mã/.test(b.textContent)).click()`);
    await sleep(300);
    const firstAfter = await s.evaluate(`document.querySelector('tbody tr td:nth-child(2) a')?.textContent`);
    check("board re-sorts on header click", firstBefore !== firstAfter, `${firstBefore} → ${firstAfter}`);
    const ariaSort = await s.evaluate(`[...document.querySelectorAll('thead th')].map(t=>t.getAttribute('aria-sort')).filter(Boolean).join(',')`);
    check("aria-sort reflects sort state", /descending|ascending/.test(ariaSort ?? ""), String(ariaSort));

    // ── watchlist round trip ──────────────────────────────────────
    await s.evaluate(`document.querySelector('tbody tr button[aria-pressed]').click()`);
    await sleep(300);
    const stored = await s.evaluate("localStorage.getItem('watchlist')");
    check("star writes to watchlist", !!stored && JSON.parse(stored).length === 1, String(stored));
    const symbol = stored ? JSON.parse(stored)[0] : null;
    await s.evaluate(`document.querySelector('tbody tr button[aria-pressed="true"]').click()`);
    await sleep(300);
    const cleared = await s.evaluate("localStorage.getItem('watchlist')");
    check("star toggles back off", cleared === null, String(cleared));
    await s.evaluate(`document.querySelector('tbody tr button[aria-pressed]').click()`);
    await sleep(300);
    await s.goto(BASE + "/vi/theo-doi", { scheme: "light" });
    await sleep(1600);
    const inList = await s.evaluate(`document.body.innerText.includes(${JSON.stringify(symbol ?? "___")})`);
    check("watchlist page renders the saved symbol", inList === true, String(symbol));

    // ── chart interaction ─────────────────────────────────────────
    await s.goto(BASE + "/vi/chung-khoan/VNM", { scheme: "light" });
    const hasSvg = await s.evaluate("!!document.querySelector('svg[role=img]')");
    check("price chart renders", hasSvg === true);
    // This route permanently redirects to the terminal, so the chart here is
    // ChartPro, which batches candle bodies into paths. The old `rect` count was
    // written for PriceChart (still rect-based, but only used by the crypto
    // detail page) and could not pass once the two symbol pages were merged.
    const candles = await s.evaluate(`(() => {
      const pane = document.querySelector('svg[role=img]');
      if (!pane) return 0;
      return [...pane.querySelectorAll('path')]
        .filter(p => /Z/.test(p.getAttribute('d') || ''))
        .reduce((n, p) => n + ((p.getAttribute('d').match(/M/g) || []).length), 0);
    })()`);
    check("candles drawn", candles > 20, `${candles} candles`);
    await s.evaluate(`(()=>{const s=document.querySelector('svg[role=img]');s.focus();s.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}));})()`);
    await sleep(300);
    const crosshair = await s.evaluate(`!!document.querySelector('[role=status]')`);
    check("keyboard arrow moves the crosshair", crosshair === true);
    await s.evaluate(`[...document.querySelectorAll('button')].find(b=>/dạng bảng/.test(b.textContent)).click()`);
    await sleep(300);
    const tableRows = await s.evaluate("document.querySelectorAll('table tbody tr').length");
    check("chart table view renders rows", tableRows > 10, `${tableRows} rows`);

    // ── line mode ─────────────────────────────────────────────────
    await s.goto(BASE + "/vi/chung-khoan/VNM", { scheme: "light" });
    await s.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Đường').click()`);
    await sleep(300);
    const paths = await s.evaluate("document.querySelectorAll('svg[role=img] path').length");
    check("line mode draws a path", paths >= 1, `${paths} paths`);

    // ── disclosure: the chart's interval menu ─────────────────────
    // This was the header's grouped-nav dropdown, which no longer exists — the
    // header renders flat links. `querySelector` returned null, `.click()` threw,
    // and every check below this point silently never ran. Retargeted at a
    // disclosure that does exist, and every call is null-safe so the next removal
    // records a FAIL row instead of aborting the suite.
    await s.goto(BASE + "/vi/bieu-do/VNM", { scheme: "light" });
    const DISC = 'button[aria-haspopup="menu"][aria-expanded]';
    const readDisc = () =>
      s.evaluate(`document.querySelector('${DISC}')?.getAttribute('aria-expanded') ?? 'missing'`);
    const closed = await readDisc();
    await s.evaluate(`document.querySelector('${DISC}')?.click()`);
    await sleep(250);
    const opened = await readDisc();
    check("interval menu opens", closed === "false" && opened === "true", `${closed} → ${opened}`);
    await s.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
    await sleep(250);
    const afterEsc = await readDisc();
    check("interval menu closes on Escape", afterEsc === "false", String(afterEsc));

    // ── the assistant is gated, so authenticate first ─────────────
    // Built with the server's real signing secret; a fabricated cookie would be
    // rejected, which is exactly what the paywall suite asserts.
    const secret = process.env.AUTH_SECRET;
    // Lets a check drop to a lower tier and restore, so the upsell paths are
    // exercised against the same running server rather than assumed.
    const asTier = async (tier) => {
      const pl = Buffer.from(JSON.stringify({
        email: "test.user@example.com", tier, read: [], iat: Math.floor(Date.now() / 1000),
      })).toString("base64url");
      await s.send("Network.setCookie", {
        name: "vnt_session",
        value: `${pl}.${nodeCrypto.createHmac("sha256", secret).update(pl).digest("base64url")}`,
        domain: new URL(BASE).hostname, path: "/", httpOnly: true, sameSite: "Lax",
      });
    };
    if (secret) {
      const payload = Buffer.from(JSON.stringify({
        email: "test.user@example.com", tier: "pro", read: [],
        iat: Math.floor(Date.now() / 1000),
      })).toString("base64url");
      const sig = nodeCrypto.createHmac("sha256", secret).update(payload).digest("base64url");
      const url = new URL(BASE);
      await s.send("Network.enable");
      await s.send("Network.setCookie", {
        name: "vnt_session", value: `${payload}.${sig}`,
        domain: url.hostname, path: "/", httpOnly: true, sameSite: "Lax",
      });
      check("signed session accepted for gated features", true, "tier=pro");
    } else {
      check("AUTH_SECRET provided for gated checks", false, "set AUTH_SECRET to exercise the assistant");
    }

    // ── ask box round trip ────────────────────────────────────────
    await s.goto(BASE + "/vi/hoi-ai", { scheme: "light" });
    await s.evaluate(`(()=>{const i=document.querySelector('#ask-input');
      const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
      set.call(i,'VNINDEX đang ở mức nào?');
      i.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await sleep(200);
    await s.evaluate(`document.querySelector('form button[type=submit]').click()`);
    const answered = (await s.waitFor(`(() => {
      const t = document.querySelector('[aria-live=polite]')?.innerText ?? '';
      return /VNINDEX \\d/.test(t) ? t : null;
    })()`)) ?? "";
    check("ask returns a grounded answer", /VNINDEX/.test(answered), answered.slice(0, 60));

    // ── the assistant refuses advice ──────────────────────────────
    await s.goto(BASE + "/vi/hoi-ai", { scheme: "light" });
    await s.evaluate(`(()=>{const i=document.querySelector('#ask-input');
      const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
      set.call(i,'Tôi có nên mua VNM không?');
      i.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await sleep(200);
    await s.evaluate(`document.querySelector('form button[type=submit]').click()`);
    const refusal = (await s.waitFor(`(() => {
      const t = document.querySelector('[aria-live=polite]')?.innerText ?? '';
      return /khuy\\u1ebfn ngh\\u1ecb/.test(t) ? t : null;
    })()`)) ?? "";
    check("assistant declines investment advice", /khuyến nghị/.test(refusal), refusal.slice(0, 60));

    // ── chart terminal ────────────────────────────────────────────
    // The chart now REMEMBERS the reader's setup, so the line-mode click a few
    // checks above survives into this one. That is the feature working; this
    // section asserts the DEFAULT rendering, so it has to start from a cleared
    // setup rather than inheriting an earlier check's choice.
    await s.evaluate("localStorage.removeItem('settings:chart')");
    await s.goto(BASE + "/vi/bieu-do/VNM", { scheme: "light" });
    const panesBefore = await s.evaluate("document.querySelectorAll('svg[role=img]').length");
    check("terminal renders price and volume panes", panesBefore >= 2, `${panesBefore} panes`);
    // Count the CANDLES, not the elements they happen to be made of: bodies are
    // batched into paths, so an element count would only be testing the
    // rendering strategy. Each candle contributes one body subpath.
    const termCandles = await s.evaluate(`(() => {
      // The price pane only: the volume pane also draws filled bars, and
      // counting both would let a broken candle pane pass on volume alone.
      const pane = document.querySelector('svg[role=img]');
      const paths = [...pane.querySelectorAll('path')];
      const bodies = paths.filter(p => /Z/.test(p.getAttribute('d') || ''));
      return bodies.reduce((n, p) => n + ((p.getAttribute('d').match(/M/g) || []).length), 0);
    })()`);
    check("every visible bar is drawn as a candle", termCandles > 50, `${termCandles} candles`);

    // Open the menu, then match the item by its LABEL. This used to look for a
    // button whose whole text was "RSI"; the menu was closed after the goto, and
    // the item's text is label+short ("RSI (14)RSI"), so it matched nothing and
    // `?.click()` silently did nothing — the check could never have passed.
    // Target the indicator menu by name: the toolbar has more than one
    // `aria-haspopup="menu"` button and the first one is the interval list, so a
    // positional selector opened the wrong menu and found no checkboxes.
    const clickInd = async (label) => {
      await s.evaluate(`(() => {
        const b = [...document.querySelectorAll('button[aria-haspopup="menu"]')]
          .find(x => x.textContent.includes('Chỉ báo'));
        if (b && b.getAttribute('aria-expanded') === 'false') b.click();
      })()`);
      await sleep(150);
      return s.evaluate(
        `[...document.querySelectorAll('[role=menuitemcheckbox]')]` +
        `.find(b => b.textContent.trim().startsWith(${JSON.stringify(label)}))?.click()`,
      );
    };
    await clickInd("RSI (14)"); await sleep(400);
    const afterRsi = await s.evaluate("document.querySelectorAll('svg[role=img]').length");
    check("adding an oscillator adds a pane", afterRsi > panesBefore, `${panesBefore} → ${afterRsi}`);
    await clickInd("RSI (14)"); await sleep(400);
    const afterOff = await s.evaluate("document.querySelectorAll('svg[role=img]').length");
    check("removing it removes the pane", afterOff === panesBefore, `${afterOff}`);

    // ── load more history (P2-16) ─────────────────────────────────
    {
      await s.evaluate("localStorage.removeItem('settings:chart')");
      await s.goto(BASE + "/vi/bieu-do/VNM?tf=1D&r=ALL", { scheme: "light" });
      await sleep(600);
      const oldestLabel = `(() => {
        const svgs = [...document.querySelectorAll('main svg')].filter(sv => sv.getAttribute('height') === '20');
        const t = svgs[0]?.querySelector('text');
        return t ? t.textContent.trim() : null;
      })()`;
      const startOldest = await s.evaluate(oldestLabel);
      // Count the history requests directly. The VISIBLE bar count is not the
      // signal — the window keeps its size, it is the reachable history that
      // grows — so asserting on it would fail a working feature.
      await s.evaluate(`(() => {
        window.__hist = 0;
        const real = window.fetch;
        window.fetch = (...a) => {
          if (String(a[0]).includes('before=')) window.__hist++;
          return real(...a);
        };
      })()`);

      // Panning to the left edge is what triggers the fetch. Shift+Left is the
      // keyboard pan, so this drives the same path a reader's drag would.
      await s.evaluate(`(() => {
        const svg = document.querySelector('svg[role=img]');
        svg.focus();
        for (let i = 0; i < 12; i++) {
          svg.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', shiftKey: true, bubbles: true }));
        }
      })()`);
      const fetched = await s.waitFor(`window.__hist > 0 ? window.__hist : null`, 12000);
      check("panning to the left edge requests older history", !!fetched, `${fetched} request(s)`);
      const nowOldest = await s.evaluate(oldestLabel);
      check("the chart really reaches further back than it started",
        nowOldest !== startOldest, `${startOldest} -> ${nowOldest}`);

      // The API contract the fetch relies on.
      const older = JSON.parse(await s.evaluate(`(async () => {
        const cut = Math.floor(Date.now() / 1000) - 400 * 86400;
        const r = await fetch('/api/bars?symbol=VNM&tf=1D&before=' + cut);
        const body = await r.json();
        const b = Array.isArray(body) ? body : (body.data ?? []);
        return JSON.stringify({ n: b.length, allBefore: b.every(x => x.t < cut) });
      })()`));
      check("/api/bars?before= serves a window that ends where asked",
        older.n > 0 && older.allBefore === true, `${older.n} bars, all older: ${older.allBefore}`);

      await s.evaluate("localStorage.removeItem('settings:chart')");
    }

    // ── route-level authorization, decided before rendering ───────
    // These 404s are decided in the proxy so the STATUS is real: once a route
    // starts streaming, notFound() can only change the markup.
    {
      const status = async (path) =>
        s.evaluate(`(async () => (await fetch(${JSON.stringify("")} + ${JSON.stringify(path)})).status)()`);
      check("the other locale's spelling of a section is a 404",
        (await status("/vi/gold")) === 404 && (await status("/en/vang")) === 404);
      check("a mispaired chart URL is a 404, not a duplicate page",
        (await status("/vi/chart/VNM")) === 404);
      check("the canonical spellings still resolve",
        (await status("/vi/vang")) === 200 && (await status("/vi/bieu-do/VNM")) === 200);
      check("the owner-only view never admits it exists",
        (await status("/vi/admin")) === 404);
    }

    // ── namespaced symbols survive the URL ────────────────────────
    // Next hands the route segment percent-encoded, so `GOLD:SJC` arrives as
    // `GOLD%3ASJC`. Undecoded it looks like an equity, finds no bars and 404s —
    // which is what shipped, because every equity symbol is plain letters and
    // so survives either way. Only a real request catches this.
    for (const [sym, label] of [["GOLD:SJC", "gold"], ["CRYPTO:bitcoin", "crypto"]]) {
      const code = await s.evaluate(`(async () => {
        const r = await fetch(${JSON.stringify("/vi/bieu-do/")} + encodeURIComponent(${JSON.stringify(sym)}));
        return r.status;
      })()`);
      check(`a ${label} symbol resolves through the URL`, code === 200, `${sym} -> ${code}`);
    }
    check("an unknown symbol is still a 404",
      (await s.evaluate(`(async () => (await fetch('/vi/bieu-do/ZZZZ')).status)()`)) === 404);

    // ── Phase 3 surfaces (P3-9) ───────────────────────────────────
    {
      // A shared setup must open the SENDER's screen, not a default chart of
      // the same symbol — that is the whole growth loop.
      await s.goto(BASE + "/vi/bieu-do/VNM?tf=1W&type=line&ind=rsi&sc=log", { scheme: "light" });
      await sleep(500);
      const tpl = await s.evaluate(`(() => {
        const btn = [...document.querySelectorAll('button')].find(b => /Chép thiết lập/.test(b.textContent||''));
        return !!btn;
      })()`);
      check("the chart offers to share its setup", tpl === true);

      // Built the same way the button builds it, then opened cold.
      const link = await s.evaluate(`(() => {
        const c = { n: "Shared", s: "VNM", e: [], g: 1, tf: "1W", ty: "line", i: ["rsi"], r: null, sc: "log", c: [], f: 0, b: 0 };
        return btoa(JSON.stringify(c)).split('+').join('-').split('/').join('_').split('=').join('');
      })()`);
      await s.goto(BASE + "/vi/bieu-do/VNM?tpl=" + link, { scheme: "light" });
      await sleep(600);
      const restored = await s.evaluate(`(() => {
        const tf = document.querySelector('[aria-label="Khung thời gian"] [aria-current=page]')?.textContent.trim();
        const rsi = !!document.querySelector('svg[aria-label^="RSI"]');
        return JSON.stringify({ tf, rsi });
      })()`);
      const rs = JSON.parse(restored);
      check("a shared setup opens the sender's screen", rs.tf === "1W" && rs.rsi === true, restored);
      check("and needs no account to open it",
        (await s.evaluate(`!!document.querySelector('svg[role=img]')`)) === true);

      // The reader's own edits win over the template they opened.
      await s.goto(BASE + "/vi/bieu-do/VNM?tf=1D&tpl=" + link, { scheme: "light" });
      await sleep(600);
      check("a parameter the reader can see beats the template",
        (await s.evaluate(`document.querySelector('[aria-label="Khung thời gian"] [aria-current=page]')?.textContent.trim()`)) === "1D");

      // The card a shared link unfurls into.
      const og = await s.evaluate(`(async () => {
        const r = await fetch('/vi/bieu-do/VNM/opengraph-image');
        return JSON.stringify({ status: r.status, type: r.headers.get('content-type') });
      })()`);
      const ogr = JSON.parse(og);
      check("a chart link previews as its own card",
        ogr.status === 200 && String(ogr.type).includes("image/png"), og);

      // The tool rail must be reachable on a phone.
      await s.goto(BASE + "/vi/bieu-do/VNM?tf=1D", { scheme: "light", width: 390, height: 1100 });
      await sleep(500);
      const rail = JSON.parse(await s.evaluate(`(() => {
        const g = document.querySelector('[role=group][aria-label="Công cụ vẽ"]');
        if (!g) return JSON.stringify({ found: false });
        const b = g.querySelector('button');
        const r = b.getBoundingClientRect();
        return JSON.stringify({ found: true, w: Math.round(r.width), h: Math.round(r.height),
          inside: r.right <= window.innerWidth + 1 });
      })()`));
      check("the drawing rail fits a 390px screen", rail.found && rail.inside === true, JSON.stringify(rail));
      check("its touch targets are big enough to hit",
        rail.w >= 40 && rail.h >= 40, `${rail.w}x${rail.h}`);
    }

    // ── the gate is explained where it is hit (P3-1) ──────────────
    {
      // Every ceiling emitted an event and then refused silently, which is
      // indistinguishable from a broken tool. Free gets 3 drawings.
      await s.evaluate("localStorage.removeItem('drawings:VNM')");
      if (secret) await asTier("free");
      await s.goto(BASE + "/vi/bieu-do/VNM?tf=1D", { scheme: "light" });
      await sleep(400);
      const r = JSON.parse(await s.evaluate(`(() => {
        const b = document.querySelector('svg[role=img]').getBoundingClientRect();
        return JSON.stringify({ l: b.left, t: b.top, w: b.width, h: b.height });
      })()`));
      const clickAt2 = async (fx, fy) => {
        const x = r.l + r.w * fx, y = r.t + r.h * fy;
        await s.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
        await s.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
        await sleep(250);
      };
      await s.evaluate(`document.querySelector('[aria-label="Mức giá"]')?.click()`);
      await sleep(150);
      // Four horizontal lines against a cap of three.
      for (const fy of [0.3, 0.45, 0.6, 0.75]) await clickAt2(0.5, fy);
      await sleep(400);
      const stored = JSON.parse(await s.evaluate(`localStorage.getItem('drawings:VNM') || '[]'`));
      check("the free drawing cap actually holds", stored.length === 3, `${stored.length} stored`);
      const hint = await s.waitFor(`(() => {
        const el = [...document.querySelectorAll('[role=status]')]
          .find(x => /nét vẽ/.test(x.textContent || ''));
        return el ? el.textContent.trim() : null;
      })()`, 4000);
      check("hitting it explains why, in place", !!hint, String(hint).slice(0, 60));
      check("and offers the way past it",
        (await s.evaluate(`(() => {
          const el = [...document.querySelectorAll('[role=status]')].find(x => /nét vẽ/.test(x.textContent||''));
          return !!el?.querySelector('a[href*="goi-dich-vu"], a[href*="dang-nhap"]');
        })()`)) === true);
      check("it never blocks the chart behind it",
        (await s.evaluate(`!!document.querySelector('svg[role=img]')`)) === true);
      await s.evaluate("localStorage.removeItem('drawings:VNM')");
      if (secret) await asTier("pro");
    }

    // ── pinch to zoom on a phone (P2-15) ──────────────────────────
    {
      // 390x1100 is the viewport the design targets, and the only place this
      // gesture exists: the chart had no zoom at all on touch.
      //
      // Driven with synthetic PointerEvents rather than CDP's touch dispatch,
      // which times out against this harness. That is a real limit worth
      // stating: this exercises the component's own gesture handling — two
      // pointers, the spread between them, the range it produces — but NOT the
      // browser's touch-action behaviour, so it cannot catch the page zooming
      // instead of the chart. The pinch arithmetic itself is unit-tested.
      await s.evaluate("localStorage.removeItem('settings:chart')");
      await s.goto(BASE + "/vi/bieu-do/VNM?tf=1D", { scheme: "light", width: 390, height: 1100 });
      await sleep(400);

      const barCount = `(() => {
        const t = document.querySelector('main')?.innerText ?? '';
        const m = t.match(/([0-9.,]+)[  ]nến/);
        return m ? Number(m[1].replace(/[.,]/g, "")) : null;
      })()`;
      const pinchBy = (from, to) => s.evaluate(`(() => {
        const svg = document.querySelector('svg[role=img]');
        const r = svg.getBoundingClientRect();
        const y = r.top + r.height / 2;
        const at = (f) => r.left + r.width * f;
        const ev = (type, id, x) => svg.dispatchEvent(new PointerEvent(type, {
          pointerId: id, pointerType: 'touch', clientX: x, clientY: y,
          buttons: 1, bubbles: true, cancelable: true,
        }));
        ev('pointerdown', 1, at(0.5 - ${from}));
        ev('pointerdown', 2, at(0.5 + ${from}));
        for (const f of ${JSON.stringify([0.25, 0.5, 0.75, 1])}.map(k => ${from} + (${to} - ${from}) * k)) {
          ev('pointermove', 1, at(0.5 - f));
          ev('pointermove', 2, at(0.5 + f));
        }
        ev('pointerup', 1, at(0.5 - ${to}));
        ev('pointerup', 2, at(0.5 + ${to}));
        return true;
      })()`);

      const before = await s.evaluate(barCount);
      await pinchBy(0.08, 0.42);
      const after = await s.waitFor(`(() => {
        const n = ${barCount};
        return n !== null && n < ${before} ? n : null;
      })()`, 5000);
      check("pinching apart zooms in on touch", !!after, `${before} -> ${after} bars`);

      const mid = await s.evaluate(barCount);
      await pinchBy(0.42, 0.06);
      const out = await s.waitFor(`(() => {
        const n = ${barCount};
        return n !== null && n > ${mid} ? n : null;
      })()`, 5000);
      check("pinching together zooms out on touch", !!out, `${mid} -> ${out} bars`);

      check("the chart does not overflow a 390px viewport",
        (await s.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1")) === true);

      await s.evaluate("localStorage.removeItem('settings:chart')");
    }

    // ── pane resize (P2-13) ───────────────────────────────────────
    {
      await s.evaluate("localStorage.removeItem('settings:chart')");
      await s.goto(BASE + "/vi/bieu-do/VNM?tf=1D", { scheme: "light" });
      await sleep(400);
      const divider = 'div[role=separator][aria-orientation=horizontal]';
      check("the price pane has a resize divider",
        (await s.evaluate(`!!document.querySelector('${divider}')`)) === true);
      // Operable by keyboard, not only by pointer.
      const before = await s.evaluate(`document.querySelector('svg[role=img]').getBoundingClientRect().height`);
      await s.evaluate(`(() => {
        const d = document.querySelector('${divider}');
        d.focus();
        for (let i = 0; i < 4; i++) {
          d.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
        }
      })()`);
      // Four presses must move four steps, not one. A held arrow key repeats far
      // faster than React re-renders, so a nudge that reads its starting point
      // from render state collapses the whole burst into a single step.
      const grew = await s.waitFor(`(() => {
        const h = document.querySelector('svg[role=img]').getBoundingClientRect().height;
        return h > ${before} + 80 ? h : null;
      })()`, 4000);
      check("repeated arrow presses compose", !!grew, `${before} -> ${grew}`);
      check("the divider reports its size to assistive tech",
        (await s.evaluate(`document.querySelector('${divider}').getAttribute('aria-valuenow')`)) !== null);
      // The whole point: it has to come back.
      await s.goto(BASE + "/vi/bieu-do/VNM?tf=1D", { scheme: "light" });
      await sleep(500);
      const after = await s.evaluate(`document.querySelector('svg[role=img]').getBoundingClientRect().height`);
      check("a resized pane survives a reload", Math.abs(after - grew) < 8, `${grew} -> ${after}`);
      await s.evaluate("localStorage.removeItem('settings:chart')");
    }

    // ── select, move, undo/redo, new tools (P2-12) ────────────────
    {
      const dr = () => s.evaluate(`localStorage.getItem('drawings:VNM') || '[]'`);
      const count = async () => JSON.parse(await dr()).length;
      await s.evaluate("localStorage.removeItem('drawings:VNM')");
      await s.goto(BASE + "/vi/bieu-do/VNM?tf=1D", { scheme: "light" });
      await sleep(300);

      const box = JSON.parse(await s.evaluate(`(() => {
        const r = document.querySelector('svg[role=img]').getBoundingClientRect();
        return JSON.stringify({ l: r.left, t: r.top, w: r.width, h: r.height });
      })()`));
      const clickAt = async (fx, fy) => {
        const x = box.l + box.w * fx, y = box.t + box.h * fy;
        await s.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
        await s.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
        await sleep(300);
      };

      for (const label of ["Tia", "Đường dọc", "Hình chữ nhật", "Ghi chú", "Đo"]) {
        check(`the rail offers "${label}"`,
          (await s.evaluate(`!!document.querySelector('[aria-label=${JSON.stringify(label)}]')`)) === true);
      }

      // A ray, drawn with two clicks like a trendline.
      await s.evaluate(`document.querySelector('[aria-label="Tia"]')?.click()`);
      await sleep(150);
      await clickAt(0.3, 0.7);
      await clickAt(0.6, 0.4);
      await sleep(400);
      const madeRay = JSON.parse(await dr());
      check("a ray is stored as its own kind", madeRay.length === 1 && madeRay[0].kind === "ray",
        String(madeRay[0]?.kind));

      // Cursor mode SELECTS rather than erasing: inspecting a drawing must not
      // destroy it, which is what it used to do.
      await s.evaluate(`document.querySelector('[aria-label="Chọn"]')?.click()`);
      await sleep(150);
      await clickAt(0.3, 0.7);
      await sleep(350);
      check("clicking a drawing selects it instead of deleting it", (await count()) === 1);
      const handles = await s.evaluate(
        `document.querySelectorAll('svg[role=img] circle[stroke-width="2"]').length`);
      check("a selected drawing shows grab handles", handles >= 1, `${handles} handles`);

      // Delete is now explicit, and undo brings it back — the property that
      // makes a canvas safe to experiment on.
      const beforeDelete = await dr();
      await s.evaluate(`document.querySelector('[aria-label="Xoá hình đã chọn"]')?.click()`);
      await sleep(350);
      check("the selected drawing can be deleted", (await count()) === 0);
      await s.evaluate(`(() => {
        const svg = document.querySelector('svg[role=img]');
        svg.focus();
        svg.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
      })()`);
      await sleep(400);
      check("undo restores a deleted drawing", (await count()) === 1);
      check("undo restores it unchanged", (await dr()) === beforeDelete);

      await s.evaluate(`(() => {
        const svg = document.querySelector('svg[role=img]');
        svg.focus();
        svg.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: true, bubbles: true }));
      })()`);
      await sleep(400);
      check("redo takes it away again", (await count()) === 0);

      await s.evaluate("localStorage.removeItem('drawings:VNM')");
    }

    // ── price axis: linear, log, percent (P2-11) ──────────────────
    // The axis is asserted by its ARITHMETIC, not by a class name: a log axis
    // is one whose tick ratios are constant, and a linear axis one whose tick
    // differences are. A control that renders but does not change the mapping
    // would pass any test that only looked at the button.
    const axisTicks = async (sc) => {
      await s.goto(BASE + `/vi/bieu-do/VNM?tf=1M&r=ALL${sc ? `&sc=${sc}` : ""}`, { scheme: "light" });
      await sleep(400);
      return s.evaluate(`(() => {
        const svg = document.querySelector('svg[role=img]');
        return [...svg.querySelectorAll('text.tnum')]
          .map(t => t.textContent.trim()).slice(0, 5);
      })()`);
    };
    const spread = (v) => {
      const n = v.map(x => Number(String(x).replace(/\./g, "").replace(",", ".")));
      return n.every(Number.isFinite) && n.length >= 4 ? n : null;
    };
    const linTicks = spread(await axisTicks(""));
    const logTicks = spread(await axisTicks("log"));
    if (linTicks && logTicks) {
      const diffs = linTicks.slice(1).map((v, i) => v - linTicks[i]);
      const evenDiff = Math.max(...diffs) - Math.min(...diffs) < 0.05;
      check("a linear axis steps by equal amounts", evenDiff, diffs.map(d => d.toFixed(2)).join(", "));
      const ratios = logTicks.slice(1).map((v, i) => v / logTicks[i]);
      const evenRatio = Math.max(...ratios) - Math.min(...ratios) < 0.01;
      check("a log axis steps by equal percentages", evenRatio, ratios.map(r => r.toFixed(3)).join(", "));
      check("the two axes are actually different",
        Math.abs(linTicks[1] - logTicks[1]) > 0.01, `${linTicks[1]} vs ${logTicks[1]}`);
    } else {
      check("a log axis steps by equal percentages", false, "could not read axis labels");
    }
    const pctTicks = await axisTicks("pct");
    check("a percent axis prints signed percentages",
      pctTicks.every(t => /^[+-].*%$/.test(t)), pctTicks.join(" "));

    // ── saved layouts (P1-6) ──────────────────────────────────────
    // LAYOUT_LIMIT existed with no consumer: the cap guarded writes that could
    // not happen. These checks are what makes it a real gate.
    await s.evaluate("localStorage.removeItem('layouts')");
    // A pro cookie is already set by this point in the run, so being anonymous
    // has to be arranged rather than assumed.
    await s.send("Network.deleteCookies", { name: "vnt_session", url: BASE });
    await s.goto(BASE + "/vi/bieu-do/VNM?tf=1W&ind=rsi&type=line", { scheme: "light" });
    await s.evaluate(`[...document.querySelectorAll('[role=tab]')].find(b => b.textContent.trim() === 'Bố cục')?.click()`);
    await sleep(300);
    const anonLayouts = await s.evaluate(`document.querySelector('#layout-name') ? 'form' : (document.querySelector('[role=tabpanel]')?.innerText ?? '')`);
    check("anon is asked to sign in rather than shown a dead form",
      anonLayouts !== "form" && /Đăng nhập/.test(String(anonLayouts)), String(anonLayouts).slice(0, 40));

    if (secret) {
      await asTier("free");
      await s.goto(BASE + "/vi/bieu-do/VNM?tf=1W&ind=rsi&type=line", { scheme: "light" });
      await s.evaluate(`[...document.querySelectorAll('[role=tab]')].find(b => b.textContent.trim() === 'Bố cục')?.click()`);
      await sleep(300);
      check("a signed-in reader gets the save form",
        (await s.evaluate(`!!document.querySelector('#layout-name')`)) === true);

      const type = async (v) => s.evaluate(`(() => {
        const i = document.querySelector('#layout-name');
        const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        set.call(i, ${JSON.stringify(v)});
        i.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
      await type("Tuan VNM");
      await s.evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Lưu bố cục hiện tại')?.click()`);
      await sleep(400);
      const stored = await s.evaluate(`localStorage.getItem('layouts')`);
      check("saving writes the layout to this device", /Tuan VNM/.test(String(stored)), String(stored).slice(0, 70));
      // The capture must be of the chart actually on screen, not a default one.
      check("the saved layout captured the current setup",
        /"tf":"1W"/.test(String(stored)) && /"type":"line"/.test(String(stored)) && /"rsi"/.test(String(stored)),
        String(stored).slice(0, 120));

      // Free gets exactly one slot, and the second save must say so.
      await type("Second");
      await s.evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Lưu bố cục hiện tại')?.click()`);
      await sleep(400);
      const capped = await s.evaluate(`document.querySelector('[aria-live=polite]')?.innerText ?? ''`);
      check("free hits the one-layout ceiling and is told why",
        /giới hạn/.test(capped), capped.slice(0, 60));
      check("the refused layout was not stored",
        !/Second/.test(String(await s.evaluate(`localStorage.getItem('layouts')`))));

      // Recall: from a bare chart, opening the layout must restore the setup.
      await s.goto(BASE + "/vi/bieu-do/FPT", { scheme: "light" });
      await s.evaluate(`[...document.querySelectorAll('[role=tab]')].find(b => b.textContent.trim() === 'Bố cục')?.click()`);
      await sleep(300);
      check("a saved layout survives a reload",
        (await s.evaluate(`/Tuan VNM/.test(document.querySelector('[role=tabpanel]')?.innerText ?? '')`)) === true);
      await s.evaluate(`[...document.querySelectorAll('[role=tabpanel] button')].find(b => /Tuan VNM/.test(b.textContent))?.click()`);
      const recalled = await s.waitFor(`location.pathname.includes('/VNM') && location.search.includes('tf=1W') ? location.pathname + location.search : null`, 6000);
      check("opening a layout restores its chart", !!recalled, String(recalled));

      await s.evaluate("localStorage.removeItem('layouts')");
      await asTier("pro");
    }

    // ── indicator periods are tunable (P2-10) ─────────────────────
    // Tuning is free, so this runs without a session. The knob hangs off the
    // legend chip; the chart, the pane label and the URL must all agree
    // afterwards, or a reader cannot share the chart they tuned.
    await s.goto(BASE + "/vi/bieu-do/VNM?ind=rsi", { scheme: "light" });
    await sleep(400);
    check("an untuned indicator labels itself with the registry default",
      (await s.evaluate(`document.querySelector('svg[aria-label^="RSI"]')?.getAttribute('aria-label')`)) === "RSI (14)");
    await s.evaluate(`[...document.querySelectorAll('button[aria-label^="Chu kỳ"]')][0]?.click()`);
    await sleep(200);
    const hasPeriodInput = await s.evaluate(`!!document.querySelector('#per-rsi')`);
    check("the legend chip opens a period control", hasPeriodInput === true);
    await s.evaluate(`(() => {
      const i = document.querySelector('#per-rsi');
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      set.call(i, '21');
      i.dispatchEvent(new Event('input', { bubbles: true }));
      i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    })()`);
    const tuned = await s.waitFor(`(() => {
      const l = document.querySelector('svg[aria-label^="RSI"]')?.getAttribute('aria-label');
      return l === 'RSI (21)' ? l : null;
    })()`, 4000);
    check("tuning the period retitles the pane", tuned === "RSI (21)", String(tuned));
    const tunedUrl = await s.waitFor(`location.search.includes('rsi%3A21') || location.search.includes('rsi:21') ? location.search : null`, 4000);
    check("a tuned period is carried in the URL", !!tunedUrl, String(tunedUrl));
    // The reload is the whole promise of P1-5 extended to periods: a chart a
    // reader tuned must come back tuned.
    await s.goto(BASE + "/vi/bieu-do/VNM", { scheme: "light" });
    await sleep(500);
    const survived = await s.evaluate(`document.querySelector('svg[aria-label^="RSI"]')?.getAttribute('aria-label')`);
    check("a tuned period survives a reload", survived === "RSI (21)", String(survived));
    // Surviving a reload is the point, so this check leaves a tuned RSI stored.
    // Clear it: later checks assume the chart's default setup, and inheriting
    // one section's state is how this suite has broken before.
    await s.evaluate("localStorage.removeItem('settings:chart')");

    await s.evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Đường')?.click()`);
    await sleep(350);
    const termPaths = await s.evaluate("document.querySelectorAll('svg[role=img] path').length");
    check("line mode draws a path", termPaths >= 1, `${termPaths} paths`);

    await s.evaluate(`(()=>{const g=document.querySelector('svg[role=img]');g.focus();
      g.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}));})()`);
    await sleep(300);
    check("keyboard moves the crosshair", await s.evaluate(`!!document.querySelector('[role=status]')`));

    const counter = await s.evaluate(`(() => {
      const t = document.querySelector('main')?.innerText ?? '';
      const m = t.match(/(\\d+)\\/(\\d+)/g) || [];
      return m.find(x => /^\\d+\\/(1|2|8|25)$/.test(x)) ?? null;
    })()`);
    check("indicator budget is shown", counter !== null, String(counter));

    // ── drawing tools (Pro; the suite runs with a pro session) ────
    if (secret) {
      await s.goto(BASE + "/vi/bieu-do/VNM", { scheme: "light" });
      await s.evaluate("localStorage.removeItem('drawings:VNM')");
      await s.goto(BASE + "/vi/bieu-do/VNM", { scheme: "light" });

      // A locked tool is no longer `disabled` — it is a button that explains the
      // lock — so `!b.disabled` was true for every tier and could not fail. What
      // separates the two states is `aria-pressed`: only a usable tool is a
      // toggle, and only an unlocked tool answers to its bare name (a locked one
      // has the reason appended).
      const drawEnabled = await s.evaluate(`(() => {
        const b = document.querySelector('[aria-label="Mức giá"]');
        return b ? b.getAttribute('aria-pressed') !== null : null;
      })()`);
      check("pro can reach the drawing tools", drawEnabled === true, String(drawEnabled));

      await s.evaluate(`document.querySelector('[aria-label="Mức giá"]')?.click()`);
      await sleep(250);
      const box = await s.evaluate(`(() => { const r = document.querySelector('svg[role=img]').getBoundingClientRect();
        return JSON.stringify({ x: r.left + r.width * 0.5, y: r.top + r.height * 0.4 }); })()`);
      const { x: cx, y: cy } = JSON.parse(box);
      await s.send("Input.dispatchMouseEvent", { type: "mousePressed", x: cx, y: cy, button: "left", clickCount: 1 });
      await s.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: cx, y: cy, button: "left", clickCount: 1 });
      await sleep(450);

      const drawn = await s.evaluate(`JSON.parse(localStorage.getItem('drawings:VNM') || '[]').length`);
      check("clicking the chart creates a drawing", drawn === 1, `${drawn} stored`);

      // The point of storing in data space: a range change must not move it.
      await s.evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '250')?.click()`);
      await sleep(550);
      const after = await s.evaluate(`JSON.stringify({
        stored: JSON.parse(localStorage.getItem('drawings:VNM') || '[]').length,
        rendered: document.querySelectorAll('line[stroke-dasharray="4 3"]').length,
      })`);
      const a = JSON.parse(after);
      check("drawings survive a range change", a.stored === 1 && a.rendered === 1, after);

      await s.evaluate(`(document.querySelector('[aria-label="Xoá hình vẽ"]')
        || [...document.querySelectorAll('button')].find(b => /Xoá hình vẽ/.test(b.textContent)))?.click()`);
      await sleep(350);
      const cleared = await s.evaluate(`JSON.parse(localStorage.getItem('drawings:VNM') || '[]').length`);
      check("clear removes every drawing", cleared === 0, `${cleared} left`);

      // ── timeframes ──────────────────────────────────────────────
      await s.goto(BASE + "/vi/bieu-do/VNM", { scheme: "light" });
      const quick = await s.evaluate(`[...document.querySelectorAll('[aria-label="Khung thời gian"] a')].map(a => a.textContent.trim()).join(",")`);
      check("quick timeframes are one click away", quick.includes("1D") && quick.includes("1h"), quick);

      await s.evaluate(`document.querySelector('button[aria-haspopup="menu"]')?.click()`);
      await sleep(250);
      const menu = await s.evaluate(`(() => {
        const m = document.querySelector('[role=menu]');
        if (!m) return JSON.stringify({ open: false });
        return JSON.stringify({
          open: true,
          groups: [...m.querySelectorAll('ul')].map(u => u.previousElementSibling?.textContent.trim()),
          items: m.querySelectorAll('[role=menuitem]').length,
        });
      })()`);
      const mv = JSON.parse(menu);
      check("the full interval list opens", mv.open === true, menu);
      check("intervals are grouped like a terminal", (mv.groups || []).length === 3, (mv.groups || []).join("/"));
      check("pro reaches every interval", mv.items === 15, `${mv.items} items`);

      // Escape must close it — a dropdown you cannot dismiss by keyboard is a trap.
      await s.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
      await sleep(200);
      check("Escape closes the interval list", (await s.evaluate(`!document.querySelector('[role=menu]')`)) === true);

      await s.goto(BASE + "/vi/bieu-do/VNM?tf=1h", { scheme: "light" });
      check("an hourly chart selects the hourly pill",
        (await s.evaluate(`document.querySelector('[aria-label="Khung thời gian"] [aria-current=page]')?.textContent.trim()`)) === "1h");

      // The axis of every timeframe must be INFORMATIVE. The bug this guards:
      // a clock-only intraday axis printed "09:00" at all six ticks once the
      // window spanned more than a day, which tells the reader nothing.
      const axis = async () => s.evaluate(`(() => {
        const svgs = [...document.querySelectorAll('svg')].filter(s => s.getAttribute('height') === '20');
        const last = svgs[svgs.length - 1];
        return JSON.stringify(last ? [...last.querySelectorAll('text')].map(t => t.textContent.trim()) : []);
      })()`);

      for (const tf of ["5m", "1h", "1D"]) {
        await s.goto(BASE + `/vi/bieu-do/VNM?tf=${tf}`, { scheme: "light" });
        const labels = JSON.parse(await axis());
        const distinct = new Set(labels).size;
        check(`${tf} axis labels are all distinct`, labels.length >= 3 && distinct === labels.length,
          `${distinct}/${labels.length}: ${labels.join(" ")}`);
      }

      // Inside a single day a minute chart must fall back to the clock, or the
      // reader cannot tell two ticks on the same date apart.
      await s.goto(BASE + "/vi/bieu-do/VNM?tf=5m", { scheme: "light" });
      const fine = JSON.parse(await axis());
      check("a minute axis mixes dates and clock times",
        fine.some((l) => /^[0-9]{2}:[0-9]{2}$/.test(l)) && fine.some((l) => /^[0-9]{2}\/[0-9]{2}$/.test(l)),
        fine.join(" "));

      const dailyLabels = JSON.parse(await (async () => {
        await s.goto(BASE + "/vi/bieu-do/VNM?tf=1D", { scheme: "light" });
        return axis();
      })());
      check("a daily axis carries no clock times",
        dailyLabels.every((l) => !/^[0-9]{2}:[0-9]{2}$/.test(l)), dailyLabels.join(" "));

      // ── interval shortcuts ──────────────────────────────────────
      const tfNow = async () => s.evaluate(
        `document.querySelector('[aria-label="Khung thời gian"] [aria-current=page]')?.textContent.trim()`);
      const press = async (key) => {
        await s.send("Input.dispatchKeyEvent", { type: "keyDown", key, text: key.length === 1 ? key : undefined });
        await s.send("Input.dispatchKeyEvent", { type: "keyUp", key });
        await sleep(120);
      };

      await s.goto(BASE + "/vi/bieu-do/VNM?tf=1D", { scheme: "light" });
      await press("]"); await sleep(900);
      check("] steps to a longer interval", (await tfNow()) === "1W", String(await tfNow()));
      await press("["); await sleep(900);
      check("[ steps back to a shorter interval", (await tfNow()) === "1D", String(await tfNow()));

      await press("1"); await press("5"); await press("m"); await sleep(900);
      check("typing an interval jumps to it", (await tfNow()) === "15m", String(await tfNow()));

      await press("1"); await press("h"); await sleep(900);
      check("typing works from an intraday interval too", (await tfNow()) === "1h", String(await tfNow()));

      // THE regression this guards: the alert price field is on this page, and a
      // shortcut that ignores focus changes the chart every time you type a price.
      // `?rail=alerts` is required: the rail opens on the watchlist tab, so
      // #alert-price was not in the DOM at all, `?.focus()` was a no-op, and the
      // keystrokes went to the chart — the check reported the regression it
      // guards against even when the guard was working.
      await s.goto(BASE + "/vi/bieu-do/VNM?tf=1D&rail=alerts", { scheme: "light" });
      await s.evaluate(`document.querySelector('#alert-price')?.focus()`);
      await press("1"); await press("5"); await press("m"); await sleep(800);
      check("typing in the alert field does not move the chart", (await tfNow()) === "1D", String(await tfNow()));
      const fieldText = await s.evaluate(`document.querySelector('#alert-price')?.value ?? ''`);
      check("the alert field kept what was typed", fieldText.includes("15"), JSON.stringify(fieldText));

      // The list shortcut, and the escape hatch out of it.
      await s.goto(BASE + "/vi/bieu-do/VNM?tf=1D", { scheme: "light" });
      await press(","); await sleep(350);
      check(", opens the interval list", (await s.evaluate(`!!document.querySelector('[role=menu]')`)) === true);
      await press("Escape"); await sleep(300);
      check("Escape closes it again", (await s.evaluate(`!document.querySelector('[role=menu]')`)) === true);

      // A locked interval must SAY it is locked. Refusing silently reads as a
      // broken keyboard, which is worse than the paywall it is enforcing.
      await asTier("free");
      await s.goto(BASE + "/vi/bieu-do/VNM?tf=1D", { scheme: "light" });
      await press("5"); await press("m"); await sleep(700);
      const refusal = await s.evaluate(`(() => {
        const n = [...document.querySelectorAll('[role=status]')].map(e => e.textContent.trim());
        return JSON.stringify({ tf: document.querySelector('[aria-label="Khung thời gian"] [aria-current=page]')?.textContent.trim(), notes: n });
      })()`);
      const rf = JSON.parse(refusal);
      check("free stays on daily when typing a locked interval", rf.tf === "1D", String(rf.tf));
      check("free is told why the interval did not change",
        (rf.notes || []).some((t) => /Plus/.test(t)), (rf.notes || []).join(" | "));

      await press("["); await sleep(700);
      check("free cannot step into intraday either",
        (await s.evaluate(`document.querySelector('[aria-label="Khung thời gian"] [aria-current=page]')?.textContent.trim()`)) === "1D");
      await asTier("pro");

      // ── panning into the past ───────────────────────────────────
      await s.goto(BASE + "/vi/bieu-do/VNM?tf=1D", { scheme: "light" });
      const axisFirst = async () => s.evaluate(`(() => {
        const svgs = [...document.querySelectorAll('svg')].filter(s => s.getAttribute('height') === '20');
        const t = svgs[svgs.length - 1]?.querySelector('text');
        return t ? t.textContent.trim() : null;
      })()`);

      const panFrom = await axisFirst();
      const rect = JSON.parse(await s.evaluate(`(() => { const r = document.querySelector('svg[role=img]').getBoundingClientRect();
        return JSON.stringify({ x: r.left + r.width * 0.5, y: r.top + r.height * 0.5 }); })()`));
      // Drag to the right: older bars should come into view.
      await s.send("Input.dispatchMouseEvent", { type: "mousePressed", x: rect.x, y: rect.y, button: "left", clickCount: 1, buttons: 1 });
      for (let i = 1; i <= 6; i++) {
        await s.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: rect.x + i * 40, y: rect.y, button: "left", buttons: 1 });
        await sleep(60);
      }
      await s.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: rect.x + 240, y: rect.y, button: "left", clickCount: 1, buttons: 0 });
      await sleep(500);
      const panTo = await axisFirst();
      check("dragging right walks into the past", panFrom !== null && panTo !== null && panFrom !== panTo,
        `${panFrom} → ${panTo}`);

      const backBtn = await s.evaluate(`[...document.querySelectorAll('button')].some(b => /Về hiện tại/.test(b.textContent))`);
      check("a way back to the present appears", backBtn === true);
      await s.evaluate(`[...document.querySelectorAll('button')].find(b => /Về hiện tại/.test(b.textContent))?.click()`);
      await sleep(450);
      check("it returns to the latest bars", (await axisFirst()) === panFrom, `${await axisFirst()} vs ${panFrom}`);

      // A drag must not leave a drawing behind: the press was a pan, not a click.
      await s.evaluate("localStorage.removeItem('drawings:VNM')");
      await s.goto(BASE + "/vi/bieu-do/VNM?tf=1D", { scheme: "light" });
      await s.evaluate(`document.querySelector('[aria-label="Mức giá"]')?.click()`);
      await sleep(200);
      await s.send("Input.dispatchMouseEvent", { type: "mousePressed", x: rect.x, y: rect.y, button: "left", clickCount: 1, buttons: 1 });
      await s.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: rect.x + 160, y: rect.y, button: "left", buttons: 1 });
      await s.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: rect.x + 160, y: rect.y, button: "left", clickCount: 1, buttons: 0 });
      await sleep(400);
      check("keyboard panning is available too",
        (await s.evaluate(`typeof document.querySelector('svg[role=img]').onkeydown !== 'undefined'`)) === true);

      // ── wheel zoom ──────────────────────────────────────────────
      // Wrapped: the chart binds wheel non-passively so it can preventDefault,
      // and `Input.dispatchMouseEvent` into it does not always get acknowledged.
      // A timeout here must record failures and let the remaining ~40 checks run,
      // not abort the suite the way the stale nav selector used to.
      // Declared outside the try: the ctrl+wheel check below reuses both, and
      // scoping them to the guarded block left it referencing dead bindings.
      await s.goto(BASE + "/vi/bieu-do/VNM?tf=1D", { scheme: "light" });
      // The zoom level is the BAR COUNT beside the range group, not the pressed
      // pill: the presets are named ("3M"), and a wheel-scroll lands between
      // them, where claiming a preset would be a lie. The count is what actually
      // changes when you zoom.
      const rangePill = async () => s.evaluate(
        `(() => {
          const m = (document.querySelector('main')?.innerText ?? '').match(/([0-9.,]+)\\s*nến/);
          return m ? m[1].replace(/\\./g, '') : null;
        })()`);
      const plot = JSON.parse(await s.evaluate(`(() => { const r = document.querySelector('svg[role=img]').getBoundingClientRect();
        return JSON.stringify({ x: r.left + r.width * 0.5, y: r.top + r.height * 0.5 }); })()`));

      try {
        // Driven from the KEYBOARD, not the wheel. Chrome's Input.dispatchMouseEvent
        // is never acknowledged by the chart's non-passive wheel listener, so a
        // wheel-based assertion tests the transport rather than the zoom. `+`/`-`
        // run the same `zoomAt` through a path a keyboard user actually uses, and
        // the wheel's own contract (it must not scroll the page) is checked below.
        const key = async (k) => {
          await s.send("Input.dispatchKeyEvent", { type: "keyDown", key: k, text: k });
          await s.send("Input.dispatchKeyEvent", { type: "keyUp", key: k });
          await sleep(250);
        };
        await s.evaluate(`document.querySelector('svg[role=img]')?.focus()`);
        const zStart = await rangePill();
        await key("+");
        const zIn = await rangePill();
        check("keyboard + zooms in", zStart !== null && zIn !== null && Number(zIn) < Number(zStart), `${zStart} → ${zIn}`);

        await key("-"); await key("-");
        const zOut = await rangePill();
        check("keyboard - zooms back out", Number(zOut) > Number(zIn), `${zIn} → ${zOut}`);

        // The zoomed level must be readable, not just implied by the drawing.
        check("the zoom level is shown in the toolbar", zOut !== null && /^[0-9]+$/.test(zOut), String(zOut));
      } catch (e) {
        check("wheel zoom is exercisable", false, String(e).slice(0, 80));
      }

      // Zooming must not scroll the page out from under the chart.
      await s.goto(BASE + "/vi/bieu-do/VNM?tf=1D", { scheme: "light" });
      // Park the page mid-scroll so it has room to move in BOTH directions —
      // asserting "still zero" at the top of the page proves nothing.
      await s.evaluate(`window.scrollTo(0, 300)`);
      await sleep(250);
      const scrollBefore = await s.evaluate(`window.scrollY`);
      const chartAt = JSON.parse(await s.evaluate(`(() => { const r = document.querySelector('svg[role=img]').getBoundingClientRect();
        return JSON.stringify({ x: r.left + r.width * 0.5, y: r.top + r.height * 0.5 }); })()`));
      check("the page was actually scrollable for this check", scrollBefore > 0, String(scrollBefore));
      await s.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: chartAt.x, y: chartAt.y, deltaX: 0, deltaY: -120 });
      await sleep(400);
      const scrollAfter = await s.evaluate(`window.scrollY`);
      check("wheel over the chart does not scroll the page", scrollAfter === scrollBefore, `${scrollBefore} → ${scrollAfter}`);

      // Ctrl+wheel is how a reader zooms the page; taking it removes an
      // accessibility affordance, so the chart must ignore it.
      await s.goto(BASE + "/vi/bieu-do/VNM?tf=1D", { scheme: "light" });
      const ctrlBefore = await rangePill();
      await s.send("Input.dispatchMouseEvent", {
        type: "mouseWheel", x: plot.x, y: plot.y, deltaX: 0, deltaY: -120, modifiers: 2,
      });
      await sleep(400);
      check("ctrl+wheel is left to the browser", (await rangePill()) === ctrlBefore, `${ctrlBefore} → ${await rangePill()}`);

      // ── T+2.5 entry marker ──────────────────────────────────────
      // A VN holder cannot sell what they just bought; no global charting tool
      // models that. The marker seeds a purchase at a real bar so the settlement
      // line has somewhere to land.
      await s.goto(BASE + "/vi/bieu-do/VNM?tf=1D", { scheme: "light" });
      const seeded = await s.evaluate(`(async () => {
        const r = await fetch('/api/bars?symbol=VNM&tf=1D');
        const j = await r.json();
        const bars = j.data ?? [];
        if (bars.length < 10) return 'no-bars';
        const b = bars[bars.length - 6];
        localStorage.setItem('drawings:VNM', JSON.stringify([
          { id: 'tr1', kind: 'trade', t: b.t, price: b.c },
        ]));
        return String(b.c);
      })()`);
      await s.goto(BASE + "/vi/bieu-do/VNM?tf=1D", { scheme: "light" });
      await sleep(700);
      const entryLine = await s.evaluate(
        `document.querySelectorAll('svg[role=img] line[stroke-dasharray="6 2"]').length`);
      check("an entry marker draws its level", entryLine >= 1, `${entryLine} @ ${seeded}`);
      const unrealised = await s.evaluate(
        `/[▲▼]\\s*[+-]?[0-9.,]+%/.test(document.querySelector('svg[role=img]')?.textContent ?? '')`);
      check("the marker shows the unrealised move, signed and glyphed", unrealised === true);
      await s.evaluate("localStorage.removeItem('drawings:VNM')");

      // ── market breadth (Pro) ────────────────────────────────────
      // An index is cap-weighted, so it can rise while most of the board falls.
      // This is the pane that says which — and it is the Pro tier's flagship, so
      // it has to actually render for a Pro reader, not just gate for everyone.
      await s.goto(BASE + "/vi/bieu-do/VNM?tf=1D&br=1", { scheme: "light" });
      await sleep(1200); // thirty member fetches on a cold cache
      const breadthPane = await s.evaluate(
        `document.querySelectorAll('svg[aria-label*="rộng"]').length`);
      check("pro gets the breadth pane", breadthPane >= 1, `${breadthPane} panes`);
      const breadthReading = await s.evaluate(`(() => {
        const el = document.querySelector('svg[aria-label*="rộng"]');
        const m = (el?.textContent ?? '').match(/([0-9]{1,3})%/);
        return m ? Number(m[1]) : null;
      })()`);
      check("breadth reads as a percentage of the market",
        breadthReading !== null && breadthReading >= 0 && breadthReading <= 100,
        String(breadthReading));

      // ── compare overlays ────────────────────────────────────────
      // The pricing page claimed "compare symbols" while only VNINDEX worked.
      // Pro gets three, each with its own dash pattern so they are told apart
      // without relying on colour.
      await s.goto(BASE + "/vi/bieu-do/VNM?tf=1D&cmp=VNINDEX,HPG,FPT", { scheme: "light" });
      await sleep(400);
      const overlays = await s.evaluate(`(() => {
        const pane = document.querySelector('svg[role=img]');
        if (!pane) return 0;
        const dashes = new Set();
        pane.querySelectorAll('path[stroke-dasharray]').forEach((p) => {
          if (p.getAttribute('fill') === 'none') dashes.add(p.getAttribute('stroke-dasharray'));
        });
        return dashes.size;
      })()`);
      check("pro overlays several symbols at once", overlays >= 3, `${overlays} dash patterns`);
      const legend = await s.evaluate(
        `(document.querySelector('svg[role=img]')?.textContent ?? '')`);
      check("each overlay is named in the legend",
        /VNINDEX/.test(legend) && /HPG/.test(legend) && /FPT/.test(legend), "VNINDEX/HPG/FPT");

      // The legacy link shape must keep working.
      await s.goto(BASE + "/vi/bieu-do/VNM?tf=1D&cmp=1", { scheme: "light" });
      await sleep(400);
      const legacy = await s.evaluate(
        `/VNINDEX/.test(document.querySelector('svg[role=img]')?.textContent ?? '')`);
      check("a cmp=1 link shared before this still means VNINDEX", legacy === true);

      // ── export the chart as a picture ───────────────────────────
      // The failure this catches is silent: the chart paints with CSS variables
      // and currentColor, and an SVG isolated inside an <img> resolves neither,
      // so a naive export saves a black rectangle that still "works".
      await s.goto(BASE + "/vi/bieu-do/VNM?tf=1D", { scheme: "light" });
      const png = await s.evaluate(`(async () => {
        const svg = document.querySelector('svg[role=img]');
        if (!svg) return 'no-pane';
        const clone = svg.cloneNode(true);
        const from = [svg, ...svg.querySelectorAll('*')];
        const to = [clone, ...clone.querySelectorAll('*')];
        from.forEach((el, i) => {
          const cs = getComputedStyle(el);
          const d = to[i];
          if (cs.fill && cs.fill !== 'none') d.setAttribute('fill', cs.fill);
          if (cs.stroke && cs.stroke !== 'none') d.setAttribute('stroke', cs.stroke);
        });
        clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        const markup = new XMLSerializer().serializeToString(clone);
        const img = await new Promise((res, rej) => {
          const im = new Image();
          im.onload = () => res(im); im.onerror = () => rej(new Error('x'));
          im.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(markup);
        });
        const c = document.createElement('canvas');
        c.width = img.width; c.height = img.height;
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0);
        // Count distinct colours: a blank or all-black export has almost none.
        const data = ctx.getImageData(0, 0, c.width, c.height).data;
        const seen = new Set();
        for (let i = 0; i < data.length; i += 4 * 97) {
          seen.add(data[i] + ',' + data[i+1] + ',' + data[i+2]);
        }
        return JSON.stringify({ w: c.width, h: c.height, colours: seen.size });
      })()`);
      const shot = png && png !== 'no-pane' ? JSON.parse(png) : null;
      check("the chart renders to a canvas at full size", !!shot && shot.w > 300 && shot.h > 200,
        shot ? `${shot.w}x${shot.h}` : String(png));
      check("the exported image keeps its colours", !!shot && shot.colours >= 3,
        shot ? `${shot.colours} distinct` : "none");

      const shareBtns = await s.evaluate(
        `[...document.querySelectorAll('button')].filter(b => /Chép liên kết|Lưu ảnh/.test(b.textContent)).length`);
      check("the share controls are on the toolbar", shareBtns === 2, `${shareBtns} buttons`);

      // ── a link reproduces the view ──────────────────────────────
      // The story this protects: a reader bookmarks their chart, or sends it to
      // someone, and it comes back as the chart they were actually looking at
      // rather than a default one.
      await s.goto(BASE + "/vi/bieu-do/VNM?tf=1D", { scheme: "light" });
      await s.evaluate("localStorage.removeItem('settings:chart')");
      await s.goto(BASE + "/vi/bieu-do/VNM?tf=1D", { scheme: "light" });
      await s.evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Đường')?.click()`);
      await sleep(400);
      const urlAfter = await s.evaluate("location.search");
      check("changing the view rewrites the address bar", /type=line/.test(urlAfter), urlAfter);
      check("the timeframe survives the rewrite", /tf=1D/.test(urlAfter), urlAfter);

      // Reload that exact URL: the view must come back from the link alone.
      await s.goto(BASE + "/vi/bieu-do/VNM" + urlAfter, { scheme: "light" });
      const linePressed = await s.evaluate(
        `!![...document.querySelectorAll('button[aria-pressed="true"]')].find(b => b.textContent.trim() === 'Đường')`);
      check("reopening the link restores the view", linePressed === true);

      // A link must not be able to hand out a paid indicator. Checked as FREE:
      // asserting this while signed in as pro would prove nothing, because pro
      // is entitled to see them.
      await asTier("free");
      await s.goto(BASE + "/vi/bieu-do/VNM?ind=macd,bb,rsi", { scheme: "light" });
      await sleep(300);
      const chips = await s.evaluate(
        `[...document.querySelectorAll('main *')].map(e => e.textContent).join(' ')`);
      check("a link cannot grant a paid indicator to a free reader",
        !/MACD \(12/.test(chips), "MACD must not be active");
      await asTier("pro");

      // ── crosshair read-out ──────────────────────────────────────
      // Reading a level off a chart means "what price is HERE", so the pointer
      // must answer with its own height, not with the hovered candle's close.
      await s.goto(BASE + "/vi/bieu-do/VNM?tf=1D", { scheme: "light" });
      const paneBox = JSON.parse(await s.evaluate(`(() => {
        const r = document.querySelector('svg[role=img]').getBoundingClientRect();
        return JSON.stringify({ x: r.left + r.width * 0.5, y: r.top + r.height * 0.35 });
      })()`));
      await s.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: paneBox.x, y: paneBox.y });
      await sleep(350);
      const crosshair = await s.evaluate(
        `document.querySelectorAll('svg[role=img] line[stroke-dasharray="3 3"]').length`);
      check("the pointer draws a horizontal crosshair", crosshair >= 1, `${crosshair} lines`);
      const pctReadout = await s.evaluate(
        `/[+-][0-9.,]+%/.test(document.querySelector('svg[role=img]')?.textContent ?? '')`);
      check("the crosshair prints a signed distance from the last close", pctReadout === true);

      // ── dense windows decimate (P2-9) ───────────────────────────
      // A wide intraday window is the only place today where visible bars
      // exceed what the plot can resolve. The chart must stay correct there,
      // not merely fast: the columns drawn are capped, and the series high and
      // low still appear, because folding keeps extremes and sampling would not.
      await s.goto(BASE + "/vi/bieu-do/VNM?tf=5m", { scheme: "light", width: 1440, height: 900 });
      // An earlier check leaves the chart in line mode, and the setup persists,
      // so candle mode is asserted here rather than assumed.
      await s.evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Nến')?.click()`);
      await sleep(250);
      await s.evaluate(`(() => {
        const g = document.querySelector('[role=group][aria-label="Khoảng"]');
        const all = [...(g?.querySelectorAll('button') ?? [])].pop();
        all?.click();
      })()`);
      await sleep(600);
      const dense = await s.waitFor(`(() => {
        const t = document.querySelector('main')?.innerText ?? '';
        const m = t.match(/([0-9.,]+)[  ]nến/);
        const bars = m ? Number(m[1].replace(/[.,]/g, "")) : 0;
        if (bars < 850) return null;               // not a dense window yet
        const bodies = [...document.querySelectorAll('svg[role=img] path')]
          .map(p => (p.getAttribute('d') || ''))
          .filter(d => /^M[\\d.]+,[\\d.]+H/.test(d));   // candle bodies are H-rects
        const columns = bodies.reduce((n, d) => n + (d.match(/M/g) || []).length, 0);
        return { bars, columns };
      })()`, 6000);
      if (dense) {
        check("a wide intraday window exceeds what the plot can resolve",
          dense.bars > 850, `${dense.bars} bars`);
        // 1440px wide minus axis padding, at 1.5px per column, is under 1000.
        check("drawn columns are capped below the visible bar count",
          dense.columns > 0 && dense.columns < dense.bars,
          `${dense.columns} columns for ${dense.bars} bars`);
      } else {
        check("a wide intraday window exceeds what the plot can resolve", false,
          "could not reach a dense window");
      }

      // ── custom intervals ────────────────────────────────────────
      await s.goto(BASE + "/vi/bieu-do/VNM?tf=7m", { scheme: "light" });
      check("a custom interval survives the URL",
        (await s.evaluate(`document.querySelector('[aria-label="Khung thời gian"] [aria-current=page]')?.textContent.trim()`)) === "7m");
      const sevenBars = await s.evaluate(`(() => {
        const t = document.querySelector('main')?.innerText ?? '';
        const m = t.match(/([0-9.,]+)[  ]nến/);
        return m ? m[1] : null;
      })()`);
      check("a custom interval is served real bars", sevenBars !== null, String(sevenBars));

      await s.goto(BASE + "/vi/bieu-do/VNM?tf=1D", { scheme: "light" });
      await s.evaluate(`document.querySelector('button[aria-haspopup="menu"]')?.click()`);
      await sleep(250);
      check("the menu offers a custom interval field", (await s.evaluate(`!!document.querySelector('#tf-custom')`)) === true);
      await s.evaluate(`(() => {
        const i = document.querySelector('#tf-custom');
        const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        set.call(i, '9h');
        i.dispatchEvent(new Event('input', { bubbles: true }));
        i.form.requestSubmit();
      })()`);
      // Waits for the navigation instead of sleeping a fixed time: the server
      // render does more work than it used to (compare fetches, breadth), and a
      // hard-coded delay is how a suite becomes flaky rather than informative.
      const switched = await s.waitFor(
        `document.querySelector('[aria-label="Khung thời gian"] [aria-current=page]')?.textContent.trim() === '9h' || null`,
        { timeoutMs: 8000 },
      );
      check("submitting a custom interval switches the chart", switched === true);

      await s.goto(BASE + "/vi/bieu-do/VNM?tf=1D", { scheme: "light" });
      await s.evaluate(`document.querySelector('button[aria-haspopup="menu"]')?.click()`);
      await sleep(250);
      await s.evaluate(`(() => {
        const i = document.querySelector('#tf-custom');
        const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        set.call(i, '5000m');
        i.dispatchEvent(new Event('input', { bubbles: true }));
        i.form.requestSubmit();
      })()`);
      await sleep(500);
      const rejected = await s.evaluate(`(() => JSON.stringify({
        tf: document.querySelector('[aria-label="Khung thời gian"] [aria-current=page]')?.textContent.trim(),
        msg: document.querySelector('#tf-custom-hint')?.textContent.trim(),
        invalid: document.querySelector('#tf-custom')?.getAttribute('aria-invalid'),
      }))()`);
      const rj = JSON.parse(rejected);
      check("an out-of-range custom interval is refused", rj.tf === "1D", String(rj.tf));
      check("and the reader is told why", /không hợp lệ/.test(rj.msg || ""), String(rj.msg));

      // ── Fibonacci ───────────────────────────────────────────────
      await s.evaluate("localStorage.removeItem('drawings:VNM')");
      await s.goto(BASE + "/vi/bieu-do/VNM?tf=1D", { scheme: "light" });
      check("the rail offers Fibonacci tools",
        (await s.evaluate(`!!document.querySelector('[aria-label="Fibonacci thoái lui"]') && !!document.querySelector('[aria-label="Fibonacci mở rộng"]')`)) === true);

      await s.evaluate(`document.querySelector('[aria-label="Fibonacci thoái lui"]')?.click()`);
      await sleep(200);
      const fibBox = JSON.parse(await s.evaluate(`(() => { const r = document.querySelector('svg[role=img]').getBoundingClientRect();
        return JSON.stringify({ l: r.left, t: r.top, w: r.width, h: r.height }); })()`));
      const clickAt = async (fx, fy) => {
        const x = fibBox.l + fibBox.w * fx, y = fibBox.t + fibBox.h * fy;
        await s.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
        await s.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
        await sleep(300);
      };
      // Two clicks: the swing low, then the swing high.
      await clickAt(0.3, 0.8);
      await clickAt(0.7, 0.2);
      await sleep(400);

      const fib = JSON.parse(await s.evaluate(`(() => {
        const d = JSON.parse(localStorage.getItem('drawings:VNM') || '[]');
        const texts = [...document.querySelectorAll('svg[role=img] text')].map(t => t.textContent.trim());
        return JSON.stringify({ stored: d.length, kind: d[0]?.kind, labels: texts.filter(t => /%/.test(t)) });
      })()`));
      check("two clicks store one Fibonacci drawing", fib.stored === 1 && fib.kind === "fib", JSON.stringify(fib.stored));
      check("all seven retracement levels are drawn", (fib.labels || []).length === 7, `${(fib.labels || []).length} levels`);
      check("levels are labelled with ratio and price",
        (fib.labels || []).some((l) => /^0%/.test(l)) && (fib.labels || []).some((l) => /^61.8%/.test(l)),
        (fib.labels || []).join(" | "));

      // The levels must lie between the two anchors, not outside them.
      const bounded = await s.evaluate(`(() => {
        const d = JSON.parse(localStorage.getItem('drawings:VNM') || '[]')[0];
        if (!d) return false;
        const lo = Math.min(d.p1, d.p2), hi = Math.max(d.p1, d.p2);
        const nums = [...document.querySelectorAll('svg[role=img] text')]
          .map(t => t.textContent.trim()).filter(t => /%/.test(t))
          .map(t => Number(t.split('·')[1].trim().replace(/[.]/g, '').replace(/[,]/, '.')));
        return nums.every(n => n >= lo - 0.5 && n <= hi + 0.5);
      })()`);
      check("every retracement level sits inside the swing", bounded === true);

      // Extensions must project PAST the swing, which is what distinguishes them.
      await s.evaluate("localStorage.removeItem('drawings:VNM')");
      await s.goto(BASE + "/vi/bieu-do/VNM?tf=1D", { scheme: "light" });
      await s.evaluate(`document.querySelector('[aria-label="Fibonacci mở rộng"]')?.click()`);
      await sleep(200);
      await clickAt(0.3, 0.8);
      await clickAt(0.6, 0.4);
      await sleep(400);
      const ext = JSON.parse(await s.evaluate(`(() => {
        const d = JSON.parse(localStorage.getItem('drawings:VNM') || '[]');
        return JSON.stringify({ stored: d.length, kind: d[0]?.kind });
      })()`));
      check("an extension is stored as its own kind", ext.stored === 1 && ext.kind === "fibext", String(ext.kind));

      // Cursor mode erases it, the same way it erases every other drawing.
      await s.evaluate(`document.querySelector('[aria-label="Xoá hình vẽ"]')?.click()`);
      await sleep(350);
      check("Fibonacci drawings can be cleared",
        (await s.evaluate(`JSON.parse(localStorage.getItem('drawings:VNM') || '[]').length`)) === 0);

      // ── parallel trend channel ──────────────────────────────────
      {
        await s.evaluate("localStorage.removeItem('drawings:VNM')");
        await s.goto(BASE + "/vi/bieu-do/VNM?tf=1D", { scheme: "light" });
        check("the rail offers a parallel channel",
          (await s.evaluate(`!!document.querySelector('[aria-label="Kênh xu hướng song song"]')`)) === true);

        await s.evaluate(`document.querySelector('[aria-label="Kênh xu hướng song song"]')?.click()`);
        await sleep(200);
        const stored = async () => s.evaluate(`JSON.parse(localStorage.getItem('drawings:VNM') || '[]').length`);
        const note = async () => s.evaluate(`(() => {
          const n = [...document.querySelectorAll('[role=status]')].map(e => e.textContent.trim());
          return n.find(t => /điểm/.test(t)) ?? null;
        })()`);

        await clickAt(0.25, 0.75);
        check("after one click the channel is not yet a drawing", (await stored()) === 0, String(await stored()));
        check("and the reader is told how many points remain", /2/.test(String(await note())), String(await note()));

        await clickAt(0.7, 0.45);
        check("after two clicks it is still pending", (await stored()) === 0, String(await stored()));
        check("the remaining count counts down", /1/.test(String(await note())), String(await note()));

        await clickAt(0.5, 0.25);
        await sleep(400);
        check("the third click completes the channel", (await stored()) === 1, String(await stored()));
        check("the pending prompt clears", (await note()) === null, String(await note()));

        const chan = JSON.parse(await s.evaluate(`(() => {
          const d = JSON.parse(localStorage.getItem('drawings:VNM') || '[]')[0];
          return JSON.stringify(d || {});
        })()`));
        check("all three anchors are stored",
          chan.kind === "channel" && [chan.t1, chan.p1, chan.t2, chan.p2, chan.t3, chan.p3].every(Number.isFinite),
          JSON.stringify(chan.kind));

        // The two edges must be drawn parallel on screen, not merely in the data.
        const parallelOnScreen = await s.evaluate(`(() => {
          const g = [...document.querySelectorAll('svg[role=img] g')]
            .find(g => g.querySelector('polygon') && g.querySelectorAll('line').length === 2);
          if (!g) return null;
          const [a, b] = [...g.querySelectorAll('line')];
          const slope = (l) => (Number(l.getAttribute('y2')) - Number(l.getAttribute('y1')))
                             / (Number(l.getAttribute('x2')) - Number(l.getAttribute('x1')));
          return Math.abs(slope(a) - slope(b));
        })()`);
        check("the two edges are parallel on screen",
          parallelOnScreen !== null && parallelOnScreen < 1e-6, String(parallelOnScreen));

        check("the channel band is filled",
          (await s.evaluate(`!!document.querySelector('svg[role=img] polygon')`)) === true);

        // Switching tools mid-draw must not leave a half-finished anchor behind.
        await s.evaluate("localStorage.removeItem('drawings:VNM')");
        await s.goto(BASE + "/vi/bieu-do/VNM?tf=1D", { scheme: "light" });
        await s.evaluate(`document.querySelector('[aria-label="Kênh xu hướng song song"]')?.click()`);
        await sleep(150);
        await clickAt(0.3, 0.7);
        await s.evaluate(`document.querySelector('[aria-label="Đường xu hướng"]')?.click()`);
        await sleep(200);
        check("switching tools discards a half-placed drawing", (await note()) === null, String(await note()));
        await clickAt(0.4, 0.6);
        await clickAt(0.6, 0.4);
        await sleep(350);
        const after2 = JSON.parse(await s.evaluate(`(() => {
          const d = JSON.parse(localStorage.getItem('drawings:VNM') || '[]');
          return JSON.stringify({ n: d.length, kind: d[0]?.kind });
        })()`));
        check("the next tool starts from a clean slate", after2.n === 1 && after2.kind === "trend", JSON.stringify(after2));

        // Leave no drawing behind: a stored drawing makes the rail render its
        // "clear drawings" button, which later checks would match by name.
        await s.evaluate("localStorage.removeItem('drawings:VNM')");
      }

      // ── price alerts ────────────────────────────────────────────
      await s.evaluate("localStorage.removeItem('alerts')");
      // The rail opens on the watchlist tab, so the alert form is not mounted
      // without `?rail=alerts`. `#alert-price` was null and the very next
      // evaluate called a setter against it — "Illegal invocation", which threw
      // out of the whole run rather than failing one check.
      await s.goto(BASE + "/vi/bieu-do/VNM?rail=alerts", { scheme: "light" });
      const hasForm = await s.evaluate(`!!document.querySelector('#alert-price')`);
      check("pro can create alerts", hasForm === true);

      await s.evaluate(`(() => {
        const i = document.querySelector('#alert-price');
        if (!i) return;
        const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        set.call(i, '999');
        i.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
      await sleep(250);
      await s.evaluate(`document.querySelector('#alert-price')?.closest('form')?.requestSubmit()`);
      await sleep(450);
      const stored = await s.evaluate(`JSON.parse(localStorage.getItem('alerts') || '[]').length`);
      check("submitting stores the alert", stored === 1, `${stored} stored`);

      const listed = await s.evaluate(`document.body.innerText.includes('999')`);
      check("the alert appears in the list", listed === true);

      // An alert level is drawn on the price pane, so the chart shows what it is
      // watching for. Seeded AT the last close: a level outside the visible price
      // range is deliberately not drawn (it would otherwise squash every candle
      // to keep a far-away line on screen), so 999 above would prove nothing.
      // Taken from the bars API, not scraped from the read-out: parsing "C 62,70"
      // out of innerText matched a stray "C" and yielded 1, which put the alert
      // far below the visible range — where the chart correctly declines to draw
      // it, so the check failed for a reason that had nothing to do with alerts.
      const lastClose = await s.evaluate(`(async () => {
        const r = await fetch('/api/bars?symbol=VNM&tf=1D');
        const j = await r.json();
        const bars = j.data ?? [];
        return bars.length ? bars[bars.length - 1].c : null;
      })()`);
      await s.evaluate(`localStorage.setItem('alerts', JSON.stringify([{
        id: 'onchart', symbol: 'VNM', condition: 'above',
        price: ${Number(lastClose) || 60}, createdAt: Date.now(),
      }]))`);
      await s.goto(BASE + "/vi/bieu-do/VNM?rail=alerts", { scheme: "light" });
      // The level is read from localStorage through useSyncExternalStore, whose
      // server snapshot is null — so it appears one frame AFTER hydration, not
      // in the markup `goto` waits for.
      await sleep(600);
      const alertLine = await s.evaluate(
        `document.querySelectorAll('svg[role=img] line[stroke-dasharray="1 5"]').length`);
      check("an armed alert is drawn on the chart", alertLine >= 1, `${alertLine} lines @ ${lastClose}`);
      await s.evaluate("localStorage.removeItem('alerts')");

      await s.goto(BASE + "/vi/bieu-do/VNM?rail=alerts", { scheme: "light" });
      await s.evaluate(`(() => {
        const i = document.querySelector('#alert-price');
        if (!i) return;
        const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        set.call(i, '999');
        i.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
      await sleep(250);
      await s.evaluate(`document.querySelector('#alert-price')?.closest('form')?.requestSubmit()`);
      await sleep(450);

      await s.evaluate(`[...document.querySelectorAll('button[aria-label]')]
        .find(b => /^Xo\u00e1 [0-9]/.test(b.getAttribute('aria-label')))?.click()`);
      await sleep(400);
      const afterDelete = await s.evaluate(`JSON.parse(localStorage.getItem('alerts') || '[]').length`);
      check("deleting removes the alert", afterDelete === 0, `${afterDelete} left`);

      const scopeNote = await s.evaluate(`/khi b\u1ea1n m\u1edf trang/.test(document.body.innerText)`);
      check("alert scope is stated honestly", scopeNote === true);

      // ── multi-chart layout ──────────────────────────────────────
      await s.goto(BASE + "/vi/bieu-do/VNM?layout=4&s=FPT,HPG,VCB", { scheme: "light" });
      const cards = await s.evaluate(`document.querySelectorAll('main .card.min-w-0').length`);
      check("pro gets a four-chart grid", cards === 4, `${cards} charts`);

      // ── linked crosshair (P2-14) ────────────────────────────────
      // The grid was four independent charts sitting side by side. Hovering one
      // must move the crosshair in the others, and — the part that actually
      // matters — land on the SAME SESSION, not the same bar index. Two symbols
      // rarely have the same history, so an index would line up unrelated days.
      const readStamps = `(() => {
        return [...document.querySelectorAll('main .card.min-w-0')].map(card => {
          const axis = [...card.querySelectorAll('svg')].pop();
          const t = axis?.querySelector('text[fill="var(--page)"]');
          return t ? t.textContent.trim() : null;
        });
      })()`;
      const gridBox = JSON.parse(await s.evaluate(`(() => {
        const r = document.querySelector('main .card.min-w-0 svg[role=img]').getBoundingClientRect();
        return JSON.stringify({ l: r.left, t: r.top, w: r.width, h: r.height });
      })()`));
      await s.send("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: gridBox.l + gridBox.w * 0.4,
        y: gridBox.t + gridBox.h * 0.5,
      });
      const stamps = await s.waitFor(`(() => {
        const v = ${readStamps};
        return v.filter(Boolean).length >= 2 ? JSON.stringify(v) : null;
      })()`, 5000);
      const cellStamps = stamps ? JSON.parse(stamps) : [];
      const shown = cellStamps.filter(Boolean);
      check("hovering one cell shows a crosshair in the others",
        shown.length >= 2, `${shown.length} of ${cellStamps.length} cells`);
      check("every linked cell is on the same session",
        shown.length >= 2 && new Set(shown).size === 1, shown.join(" | "));
      const shareable = await s.evaluate(`location.search.includes('layout=4')`);
      check("layout lives in the URL and is shareable", shareable === true);
    }

    // ── heatmap ───────────────────────────────────────────────────
    await s.goto(BASE + "/vi/ban-do-nhiet", { scheme: "light" });
    // Tiles link to the terminal (`PATHS.terminal`), not `/chung-khoan/` — the
    // symbol page was merged into the chart and now permanently redirects, so
    // the old selector matched nothing and reported an empty heatmap.
    const TILE = 'main a[href*="/bieu-do/"]';
    const tiles = await s.evaluate(`document.querySelectorAll('${TILE}').length`);
    check("heatmap renders tiles", tiles >= 10, `${tiles} tiles`);
    const pctOnTiles = await s.evaluate(`(() => {
      const t = [...document.querySelectorAll('${TILE}')].map(a => a.innerText);
      return t.filter(x => /%/.test(x)).length;
    })()`);
    check("heatmap tiles print their percentage", pctOnTiles > 0, `${pctOnTiles} labelled`);

    // ── pricing must not fake a checkout ──────────────────────────
    await s.goto(BASE + "/vi/goi-dich-vu", { scheme: "light" });
    const pricingText = await s.evaluate("document.querySelector('main')?.innerText ?? ''");
    check("pricing states billing is not enabled", /chưa được kích hoạt/.test(pricingText), "notice present");
    const payLinks = await s.evaluate(`[...document.querySelectorAll('main a')].filter(a => /checkout|stripe|payment|thanh-toan/i.test(a.getAttribute('href')||'')).length`);
    check("pricing has no payment links", payLinks === 0, `${payLinks} payment links`);

    console.table(results);
    const failed = results.filter((r) => r.pass === "FAIL");
    if (failed.length) { console.error("FAILURES:", failed.length); process.exitCode = 1; }
    else console.log("all interaction checks passed");
  }

  s.close();
} finally {
  proc.kill();
}
