/**
 * AI-assisted quality assurance.
 *
 * Drives the app in headless Chrome, captures a screenshot plus the rendered
 * text of each page, and asks Claude to review them for visual, copy and data
 * defects — the class of bug a deterministic assertion cannot express ("the
 * arrow disagrees with the number", "this premium is off by an order of
 * magnitude", "the heading is cut off").
 *
 * If no credentials are present this SKIPS rather than pretending to run. A QA
 * step that silently fakes its own output is worse than no QA step.
 *
 *   node scripts/ai-qa.mjs            # review the default page set
 *   BASE=http://localhost:3210 node scripts/ai-qa.mjs
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9334;
const BASE = process.env.BASE ?? "http://localhost:3210";
const OUT = process.env.OUT ?? "/tmp/ai-qa";

const PAGES = (process.env.PAGES ?? "/vi,/vi/chung-khoan,/vi/vang,/vi/crypto,/vi/tin-tuc,/vi/chuyen-gia,/vi/hoi-ai,/vi/ban-tin")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const FINDINGS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["findings"],
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["severity", "category", "summary", "evidence"],
        properties: {
          severity: { type: "string", enum: ["high", "medium", "low"] },
          category: {
            type: "string",
            enum: ["data-correctness", "copy", "layout", "accessibility", "consistency"],
          },
          summary: { type: "string" },
          evidence: { type: "string" },
        },
      },
    },
  },
};

const SYSTEM = `You review rendered pages of a Vietnamese markets website (stocks, gold, crypto) for defects.

Report ONLY defects you can actually see in the screenshot or the extracted text. Prioritise:
- data-correctness: a figure that contradicts another figure on the same page; a direction glyph (▲/▼) that disagrees with the sign of its number; an implausible magnitude (e.g. a domestic-vs-world gold premium of 50%+ when ~5% is normal); a unit that is stated wrongly.
- consistency: the same quantity presented differently in two places.
- copy: truncated, untranslated, doubled, or placeholder text left visible; Vietnamese that reads as machine-translated.
- layout: clipped text, overlapping elements, a broken grid, an element overflowing its container.
- accessibility: text that appears too low-contrast to read against its background.

Rules:
- Do NOT report things you merely suspect; every finding needs concrete evidence quoted from the page.
- Do NOT report stylistic preferences, or suggest features.
- An empty findings array is the correct answer for a clean page. Say nothing rather than pad.`;

async function launch() {
  const proc = spawn(CHROME, [
    "--headless=new", `--remote-debugging-port=${PORT}`, "--disable-gpu",
    "--hide-scrollbars", "--no-first-run", "--force-color-profile=srgb",
    "--user-data-dir=/tmp/cdp-aiqa", "about:blank",
  ], { stdio: "ignore" });
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) return proc;
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
    return s;
  }
  send(method, params = {}) {
    const id = ++this.#id;
    this.#ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => this.#pending.set(id, { res, rej }));
  }
  async evaluate(expression) {
    const r = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    return r.result.value;
  }
  async capture(url) {
    await this.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1200, deviceScaleFactor: 1, mobile: false });
    await this.send("Page.enable");
    await this.send("Page.navigate", { url });
    for (let i = 0; i < 80; i++) {
      await sleep(150);
      if (await this.evaluate("document.readyState === 'complete' && !!document.querySelector('main')")) break;
    }
    await sleep(800);
    const { data } = await this.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
    const text = await this.evaluate("document.querySelector('main')?.innerText?.slice(0, 6000) ?? ''");
    return { png: data, text };
  }
  close() { try { this.#ws.close(); } catch {} }
}

// ── credentials gate ─────────────────────────────────────────────────────────
if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
  console.log("AI QA SKIPPED — no ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN in the environment.");
  console.log("This step reviews rendered pages with Claude; it does not fake results when unauthenticated.");
  process.exit(0);
}

const proc = await launch();
const client = new Anthropic();
const all = [];

try {
  const s = await Session.open();
  mkdirSync(OUT, { recursive: true });

  for (const path of PAGES) {
    const { png, text } = await s.capture(BASE + path);
    writeFileSync(`${OUT}${path.replace(/\//g, "_")}.png`, Buffer.from(png, "base64"));

    const response = await client.messages.create({
      model: "claude-opus-5",
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      output_config: {
        effort: "high",
        format: { type: "json_schema", schema: FINDINGS_SCHEMA },
      },
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/png", data: png } },
            { type: "text", text: `Page: ${path}\n\nExtracted text:\n${text}` },
          ],
        },
      ],
    });

    if (response.stop_reason === "refusal") {
      console.error(`  ${path}: model declined (${response.stop_details?.category ?? "unknown"})`);
      continue;
    }

    const body = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      console.error(`  ${path}: could not parse response as JSON`);
      continue;
    }
    for (const f of parsed.findings ?? []) all.push({ page: path, ...f });
    console.log(`  reviewed ${path} — ${parsed.findings?.length ?? 0} finding(s)`);
  }

  s.close();
} finally {
  proc.kill();
}

const rank = { high: 0, medium: 1, low: 2 };
all.sort((a, b) => rank[a.severity] - rank[b.severity]);

console.log("\n================ AI QA FINDINGS ================");
if (!all.length) {
  console.log("No defects reported.");
} else {
  for (const f of all) {
    console.log(`\n[${f.severity.toUpperCase()}] ${f.category} — ${f.page}`);
    console.log(`  ${f.summary}`);
    console.log(`  evidence: ${f.evidence}`);
  }
  writeFileSync(`${OUT}/findings.json`, JSON.stringify(all, null, 2));
  console.log(`\n${all.length} finding(s) written to ${OUT}/findings.json`);
}
if (all.some((f) => f.severity === "high")) process.exitCode = 1;
