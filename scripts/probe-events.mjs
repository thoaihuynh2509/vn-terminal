/**
 * P2-8 spike — read-only probe: do the free feeds publish corporate events?
 *
 * The roadmap allows dividend / ex-right markers ONLY if a feed already returns
 * them as data. It explicitly forbids a scraper, so an HTML page that happens to
 * show the numbers is a NO, not a maybe. This script therefore asks two things
 * of every candidate: does it answer JSON, and does that JSON name an ex-date.
 *
 * Nothing here is imported by the app. It exists so the decision in
 * docs/backend-issues.md cites an observation instead of an assumption.
 */
const SYMBOLS = ["VNM", "HPG"];
const TIMEOUT_MS = 12_000;

const CANDIDATES = [
  {
    name: "vndirect finfo v4 /events",
    url: (s) => `https://api-finfo.vndirect.com.vn/v4/events?q=code:${s}&size=20&sort=exrightDate:desc`,
  },
  {
    name: "vndirect finfo v4 /dividends",
    url: (s) => `https://api-finfo.vndirect.com.vn/v4/dividends?q=code:${s}&size=20`,
  },
  {
    name: "vndirect finfo v4 /ratios (control: known-good host)",
    url: (s) => `https://api-finfo.vndirect.com.vn/v4/ratios/latest?filter=ratioCode:MARKETCAP&where=code:${s}`,
  },
  {
    name: "dnse entrade /corporate-actions",
    url: (s) => `https://services.entrade.com.vn/chart-api/v2/corporate-actions?symbol=${s}`,
  },
  {
    name: "cafef msh-appdata events",
    url: (s) => `https://msh-appdata.cafef.vn/rest-api/api/v1/CorporateAction?symbol=${s}`,
  },
  {
    name: "ssi iboard company events",
    url: (s) => `https://iboard-query.ssi.com.vn/stock/events/${s}`,
  },
  {
    name: "vietstock finance api",
    url: (s) => `https://finance.vietstock.vn/data/eventstypebysymbol?symbol=${s}`,
  },
];

/** Keys that would make a row usable as an x-axis marker. */
const EX_DATE_HINTS = /ex[-_]?(right|div|date)|ngayGDKHQ|exerciseDate|recordDate/i;
const KIND_HINTS = /dividend|cashDividend|stockDividend|issue|eventCode|eventTitle|ratio/i;

function walkKeys(v, out = new Set(), depth = 0) {
  if (depth > 6 || v === null || typeof v !== "object") return out;
  for (const [k, child] of Object.entries(v)) {
    out.add(k);
    walkKeys(child, out, depth + 1);
  }
  return out;
}

async function probe(name, url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctl.signal,
      headers: { accept: "application/json", "user-agent": "Mozilla/5.0 (probe; read-only)" },
    });
    const ct = res.headers.get("content-type") || "";
    const body = await res.text();
    const json = ct.includes("json") || body.trimStart().startsWith("{") || body.trimStart().startsWith("[");
    let keys = [];
    if (json) {
      try { keys = [...walkKeys(JSON.parse(body))]; } catch { /* not parseable after all */ }
    }
    return {
      name, url,
      status: res.status,
      contentType: ct.split(";")[0] || "(none)",
      json,
      bytes: body.length,
      exDateKeys: keys.filter((k) => EX_DATE_HINTS.test(k)),
      kindKeys: keys.filter((k) => KIND_HINTS.test(k)),
      sample: body.slice(0, 220).replace(/\s+/g, " "),
    };
  } catch (e) {
    return { name, url, status: 0, error: e.name === "AbortError" ? `timeout ${TIMEOUT_MS}ms` : String(e.message || e) };
  } finally {
    clearTimeout(timer);
  }
}

const results = [];
for (const sym of SYMBOLS) {
  for (const c of CANDIDATES) {
    results.push(await probe(`${c.name} [${sym}]`, c.url(sym)));
  }
}

for (const r of results) {
  const verdict = r.error
    ? `ERR   ${r.error}`
    : !r.json
      ? `NO    ${r.status} ${r.contentType} (not JSON)`
      : r.exDateKeys.length
        ? `YES   ${r.status} ex-date keys: ${r.exDateKeys.join(",")}`
        : `PARTIAL ${r.status} json ${r.bytes}B, no ex-date key`;
  console.log(`\n${r.name}\n  ${r.url}\n  ${verdict}`);
  if (r.kindKeys?.length) console.log(`  event-ish keys: ${r.kindKeys.slice(0, 12).join(",")}`);
  if (r.sample) console.log(`  sample: ${r.sample}`);
}

const usable = results.filter((r) => r.exDateKeys?.length);
console.log(`\n=== ${usable.length}/${results.length} endpoints returned an ex-date field ===`);
