import test from "node:test";
import assert from "node:assert/strict";
import { clamp, faqPageLd, quoteDescription, stableFaq, symbolNarrative } from "./narrative.ts";
import type { NarrativeInput } from "./narrative.ts";
import type { Bar, Locale } from "../types.ts";

const DAY = 86_400;
const START = Date.UTC(2026, 8, 9) / 1000; // 2026-09-09

/** `n` daily bars ending at START, each close given. */
function bars(closes: number[], volume = 1_000_000): Bar[] {
  return closes.map((c, i) => ({
    t: START - (closes.length - 1 - i) * DAY,
    o: c,
    h: c * 1.01,
    l: c * 0.99,
    c,
    v: volume,
  }));
}

function input(over: Partial<NarrativeInput> = {}): NarrativeInput {
  return {
    symbol: "VNM",
    locale: "vi",
    bars: bars(Array.from({ length: 60 }, (_, i) => 60 + i * 0.1)),
    exchange: "HOSE",
    band: 0.07,
    vn30: true,
    ...over,
  };
}

/**
 * Whether `clamped` cut `original` at a word boundary.
 *
 * A correctly clamped string always ends with a letter before the ellipsis, so
 * "does it end mid-word" cannot be asked of the result alone — it has to be
 * checked against what it was cut from.
 */
function cutOnWordBoundary(original: string, clamped: string): boolean {
  if (!clamped.endsWith("\u2026")) return true;
  const kept = clamped.slice(0, -1);
  const source = original.replace(/\s+/g, " ").trim();
  if (!source.startsWith(kept)) return false;
  const next = source.charAt(kept.length);
  return next === "" || next === " ";
}

test("with no bars there is no price sentence, and nothing is invented", () => {
  for (const locale of ["vi", "en"] as const) {
    const n = symbolNarrative(input({ locale, bars: [] }));
    assert.deepEqual(n.paragraphs, []);
    assert.equal(n.asOf, null);
    assert.equal(n.description, "");
    // The stable facts survive, because none of them came from a price.
    assert.ok(n.faq.length >= 2);
  }
});

test("a single bar is still not enough to state a change", () => {
  assert.deepEqual(symbolNarrative(input({ bars: bars([61.2]) })).paragraphs, []);
});

test("every price sentence is anchored to the date it was true", () => {
  for (const locale of ["vi", "en"] as const) {
    const n = symbolNarrative(input({ locale }));
    assert.ok(n.asOf, "asOf missing");
    assert.ok(n.paragraphs[0].includes(n.asOf as string), `first paragraph lost the date: ${n.paragraphs[0]}`);
    assert.ok(n.description.includes(n.asOf as string), `description lost the date: ${n.description}`);
  }
});

test("the description fits the space Google gives it and never cuts a word in half", () => {
  for (const locale of ["vi", "en"] as const) {
    for (const symbol of ["VNM", "HPG", "SHB"]) {
      const n = symbolNarrative(input({ locale, symbol }));
      assert.ok(n.description.length <= 155, `${locale}/${symbol}: ${n.description.length} chars`);
      assert.equal(n.description.endsWith("\u2026"), false, "a full description should not need clamping");
    }
  }
});

test("clamp keeps a short string whole and ends a long one on a word", () => {
  assert.equal(clamp("short enough"), "short enough");
  const source = "alpha bravo charlie delta echo foxtrot golf hotel india juliet";
  const long = clamp(source, 30);
  assert.ok(long.length <= 30);
  assert.ok(long.endsWith("\u2026"));
  assert.ok(cutOnWordBoundary(source, long), `cut mid-word: ${long}`);

  // Collapsed whitespace, and a boundary case with no space to fall back on.
  assert.equal(clamp("  spaced   out  "), "spaced out");
  assert.ok(clamp("Supercalifragilisticexpialidocious", 12).length <= 12);
});

test("the RSI sentence appears only when an RSI was actually computed", () => {
  const without = symbolNarrative(input());
  assert.equal(without.paragraphs.some((p) => p.includes("RSI")), false);

  const with70 = symbolNarrative(input({ rsi14: 74.2 }));
  const line = with70.paragraphs.find((p) => p.includes("RSI"));
  assert.ok(line);
  assert.ok(line.includes("quá mua"));
  // Named as a calculation, never as a call.
  assert.ok(line.includes("không phải khuyến nghị"));
});

test("foreign flow is reported only when five sessions of it were loaded", () => {
  const four = symbolNarrative(input({
    foreign: [1, 2, 3, 4].map((d) => ({ date: `2026-09-0${d}`, netVal: 1e9 })),
  }));
  assert.equal(four.paragraphs.some((p) => p.includes("khối ngoại")), false);

  const five = symbolNarrative(input({
    foreign: [1, 2, 3, 4, 5].map((d) => ({ date: `2026-09-0${d}`, netVal: 4e9 })),
  }));
  const line = five.paragraphs.find((p) => p.includes("khối ngoại"));
  assert.ok(line);
  assert.ok(line.includes("mua ròng"));
  assert.ok(line.includes("tỷ đồng"));
});

test("net selling is reported as selling, with a positive figure", () => {
  const n = symbolNarrative(input({
    foreign: [1, 2, 3, 4, 5].map((d) => ({ date: `2026-09-0${d}`, netVal: -2e9 })),
  }));
  const line = n.paragraphs.find((p) => p.includes("khối ngoại")) as string;
  assert.ok(line.includes("bán ròng"));
  assert.equal(line.includes("-"), false, "a negative sign leaked into prose that already says 'bán ròng'");
});

test("only a corporate action still ahead is announced", () => {
  const past = symbolNarrative(input({ events: [{ exDate: "2026-08-01", cash: 1500, note: "" }] }));
  assert.equal(past.paragraphs.some((p) => p.includes("không hưởng quyền")), false);

  const ahead = symbolNarrative(input({
    events: [
      { exDate: "2026-12-01", cash: 2000, note: "" },
      { exDate: "2026-09-20", cash: 1500, note: "" },
    ],
  }));
  const line = ahead.paragraphs.find((p) => p.includes("không hưởng quyền")) as string;
  assert.ok(line.includes("2026-09-20"), "announced the later event instead of the next one");
});

test("volume is compared with this symbol's own recent average", () => {
  const closes = Array.from({ length: 40 }, () => 60);
  const b = bars(closes, 1_000_000);
  b[b.length - 1] = { ...b[b.length - 1], v: 3_000_000 };
  const n = symbolNarrative(input({ bars: b }));
  const line = n.paragraphs.find((p) => p.includes("Khối lượng")) as string;
  assert.ok(line);
  assert.ok(line.includes("cao hơn"));
});

test("the structured-data FAQ states no price and no figure that moves", () => {
  for (const locale of ["vi", "en"] as const) {
    const faq = stableFaq({ symbol: "VNM", locale, exchange: "HOSE", band: 0.07, vn30: true });
    const dumped = JSON.stringify(faqPageLd(faq));
    assert.equal(dumped.includes("@type"), true);
    // The only numbers allowed are the band and the indicator count, both rules
    // rather than readings. A decimal price would look like 61.2 / 61,2.
    assert.doesNotMatch(dumped, /\d+[.,]\d/, `a decimal figure reached the graph: ${dumped}`);
  }
});

test("the band is stated in percent, from the fraction the repo passes around", () => {
  // bandOf() returns 0.07. Printing it raw would say "±0.07%"; multiplying it
  // naively would say "±7.000000000000001%".
  for (const [band, want] of [[0.07, "±7%"], [0.1, "±10%"], [0.15, "±15%"]] as const) {
    const faq = stableFaq({ symbol: "AAA", locale: "vi", exchange: "HOSE", band, vn30: false });
    const answer = faq.find((f) => f.q.includes("Biên độ"))?.a as string;
    assert.ok(answer.includes(want), `wanted ${want}, got: ${answer}`);
  }
});

test("the FAQ drops the facts it was not given", () => {
  const faq = stableFaq({ symbol: "XYZ", locale: "vi", exchange: null, band: null, vn30: false });
  assert.equal(faq.length, 1, "invented an exchange or a band it had no source for");
  assert.ok(faq[0].q.includes("biểu đồ"));
});

test("VN30 membership is claimed only for a member", () => {
  const member = stableFaq({ symbol: "VNM", locale: "vi", exchange: "HOSE", band: 0.07, vn30: true });
  assert.ok(member[0].a.includes("VN30"));
  const not = stableFaq({ symbol: "AAA", locale: "vi", exchange: "HOSE", band: 0.07, vn30: false });
  assert.equal(not[0].a.includes("VN30"), false);
});

test("faqPageLd shapes every entry as a Question with an answer", () => {
  const ld = faqPageLd(stableFaq({ symbol: "VNM", locale: "en", exchange: "HOSE", band: 0.07, vn30: true }));
  assert.equal(ld["@type"], "FAQPage");
  const entries = ld.mainEntity as { "@type": string; name: string; acceptedAnswer: { text: string } }[];
  assert.ok(entries.length >= 2);
  for (const e of entries) {
    assert.equal(e["@type"], "Question");
    assert.ok(e.name.length > 0);
    assert.ok(e.acceptedAnswer.text.length > 0);
  }
});

test("a metadata description is built from one board row, or refused", () => {
  const d = quoteDescription(
    { symbol: "VNM", price: 61.2, change: 0.7, changePct: 1.16 },
    { symbol: "VNM", locale: "vi", exchange: "HOSE" },
  ) as string;
  assert.ok(d.includes("VNM"));
  assert.ok(d.includes("+1,16%"), d);
  assert.ok(d.length <= 155);

  assert.equal(quoteDescription(undefined, { symbol: "VNM", locale: "vi", exchange: "HOSE" }), null);
  assert.equal(
    quoteDescription({ symbol: "VNM", price: 0, change: 0, changePct: 0 }, { symbol: "VNM", locale: "vi", exchange: "HOSE" }),
    null,
  );
});

test("the description names no date, because the board carries none", () => {
  // The board is a live snapshot with no timestamp. Stamping the clock on it
  // dates the previous close to today whenever the session has not opened —
  // and Google keeps that sentence for weeks.
  for (const locale of ["vi", "en"] as const) {
    const d = quoteDescription(
      { symbol: "HPG", price: 22.05, change: 0.2, changePct: 0.92 },
      { symbol: "HPG", locale, exchange: "HOSE" },
    ) as string;
    assert.doesNotMatch(d, /\d{2}\/\d{2}\/\d{4}/, `a date reached the description: ${d}`);
    assert.doesNotMatch(d, /\d{4}-\d{2}-\d{2}/, `a date reached the description: ${d}`);
  }
});

test("both locales produce prose, and it is not the same prose", () => {
  const vi = symbolNarrative(input({ locale: "vi" as Locale }));
  const en = symbolNarrative(input({ locale: "en" as Locale }));
  assert.ok(vi.paragraphs.length >= 2);
  assert.equal(vi.paragraphs.length, en.paragraphs.length);
  assert.notEqual(vi.paragraphs[0], en.paragraphs[0]);
});

test("no paragraph carries a company description this file could not know", () => {
  const n = symbolNarrative(input({ rsi14: 55, foreign: [1, 2, 3, 4, 5].map((d) => ({ date: `2026-09-0${d}`, netVal: 1e9 })) }));
  const all = n.paragraphs.join(" ");
  for (const invented of ["thành lập", "trụ sở", "ngành", "công ty con", "doanh thu năm", "founded", "headquartered", "subsidiary"]) {
    assert.equal(all.includes(invented), false, `narrative invented a company fact: ${invented}`);
  }
});
