import assert from "node:assert/strict";
import test from "node:test";
import { breadcrumbLd, itemListLd, organizationLd, symbolTrail, websiteLd } from "./seo.ts";
import { LOCALES } from "./i18n/index.ts";

const SITE = "https://example.test";

test("the organization graph names a publisher and one absolute origin", () => {
  const ld = organizationLd(SITE, "VN TERMINAL", "Chứng khoán và vàng");
  assert.equal(ld["@type"], "Organization");
  assert.equal(ld.url, SITE);
  assert.equal(ld.name, "VN TERMINAL");
});

test("the website graph is per locale and declares that locale's language", () => {
  assert.equal(websiteLd(SITE, "VN TERMINAL", "vi").url, `${SITE}/vi`);
  assert.equal(websiteLd(SITE, "VN TERMINAL", "vi").inLanguage, "vi-VN");
  assert.equal(websiteLd(SITE, "VN TERMINAL", "en").url, `${SITE}/en`);
  assert.equal(websiteLd(SITE, "VN TERMINAL", "en").inLanguage, "en-US");
});

/**
 * A `SearchAction` here would advertise a query endpoint that does not exist —
 * symbol search is a client-side palette. The rich result would fail on click.
 */
test("the website graph promises no search endpoint", () => {
  assert.equal("potentialAction" in websiteLd(SITE, "VN TERMINAL", "vi"), false);
});

test("breadcrumb positions are 1-based and every item is an absolute URL", () => {
  const ld = breadcrumbLd(SITE, [
    { name: "Home", path: "/vi" },
    { name: "Board", path: "/vi/chung-khoan" },
  ]);
  const items = ld.itemListElement as Array<Record<string, unknown>>;
  assert.deepEqual(items.map((i) => i.position), [1, 2]);
  assert.deepEqual(items.map((i) => i.item), [`${SITE}/vi`, `${SITE}/vi/chung-khoan`]);
});

test("a symbol trail ends on that symbol's own chart URL", () => {
  const trail = symbolTrail("vi", "VNM", "Tổng Quan", "Bảng Giá");
  assert.equal(trail.length, 3);
  assert.equal(trail[2].name, "VNM");
  assert.equal(trail[2].path, "/vi/bieu-do/VNM");
  assert.equal(symbolTrail("en", "VNM", "Home", "Stocks")[2].path, "/en/chart/VNM");
});

/**
 * The middle crumb is the stocks BOARD, not bare `/bieu-do`, which 307s to a
 * default symbol. A crumb pointing at a redirect spends the credit it exists to
 * earn, so this pins the choice rather than leaving it to be "tidied" later.
 */
test("no crumb points at the bare terminal path", () => {
  for (const locale of LOCALES) {
    const trail = symbolTrail(locale, "HPG", "Home", "Board");
    const bare = locale === "vi" ? "/vi/bieu-do" : "/en/chart";
    assert.equal(trail.some((c) => c.path === bare), false, `${locale} must not link the bare terminal path`);
    assert.equal(trail[1].path.endsWith(locale === "vi" ? "chung-khoan" : "stocks"), true);
  }
});

test("every locale produces a complete trail", () => {
  assert.deepEqual([...LOCALES].sort(), ["en", "vi"]);
  for (const locale of LOCALES) {
    assert.equal(symbolTrail(locale, "FPT", "H", "B").every((c) => c.path.startsWith(`/${locale}/`) || c.path === `/${locale}`), true);
  }
});

test("the board's ItemList numbers its rows and points at real chart URLs", () => {
  const ld = itemListLd(SITE, [
    { name: "VNM — biểu đồ giá cổ phiếu", path: "/vi/bieu-do/VNM" },
    { name: "HPG — biểu đồ giá cổ phiếu", path: "/vi/bieu-do/HPG" },
  ]);
  assert.equal(ld["@type"], "ItemList");
  assert.equal(ld.numberOfItems, 2);
  const items = ld.itemListElement as { position: number; url: string; name: string }[];
  assert.deepEqual(items.map((i) => i.position), [1, 2]);
  assert.equal(items[0].url, `${SITE}/vi/bieu-do/VNM`);
  assert.equal(items[1].name, "HPG — biểu đồ giá cổ phiếu");
});

test("the ItemList states no price", () => {
  // Same rule the rest of this file follows: the feed may lag, so a number
  // handed to a machine that will repeat it is a liability, not a rich result.
  const ld = itemListLd(SITE, [{ name: "VNM", path: "/vi/bieu-do/VNM" }]);
  const dumped = JSON.stringify(ld);
  for (const forbidden of ["price", "offers", "Offer", "priceCurrency"]) {
    assert.equal(dumped.includes(forbidden), false, `ItemList leaked ${forbidden}`);
  }
});

test("an empty board still produces a well-formed, empty list", () => {
  const ld = itemListLd(SITE, []);
  assert.equal(ld.numberOfItems, 0);
  assert.deepEqual(ld.itemListElement, []);
});
