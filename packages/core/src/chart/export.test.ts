import test from "node:test";
import assert from "node:assert/strict";
import { exportFilename, footerText } from "./export.ts";

const at = new Date(Date.UTC(2026, 8, 7, 2, 0, 0)); // 09:00 ICT on 2026-09-07

test("the filename says what the picture is and sorts by date", () => {
  assert.equal(exportFilename({ symbol: "vnm", tf: "1D", at }), "VNM-1D-2026-09-07.png");
});

test("the filename cannot escape the downloads folder", () => {
  // Dropped, never substituted: substitution could collapse two symbols to one.
  const name = exportFilename({ symbol: "../../etc/passwd", tf: "1/D", at });
  assert.ok(!name.includes("/"));
  assert.ok(!name.includes(".."));
  assert.match(name, /^[A-Za-z0-9-]+\.png$/);
});

test("an unnameable symbol still produces a usable filename", () => {
  assert.equal(exportFilename({ symbol: "!!!", tf: "***", at }), "CHART-1D-2026-09-07.png");
});

test("the date is the market's day, not the viewer's", () => {
  // 23:30 UTC on the 6th is already the 7th in Ho Chi Minh City.
  const lateUtc = new Date(Date.UTC(2026, 8, 6, 23, 30, 0));
  assert.match(exportFilename({ symbol: "VNM", tf: "1D", at: lateUtc }), /2026-09-07/);
});

test("the footer credits the origin without the scheme", () => {
  assert.equal(
    footerText({ symbol: "VNM", tf: "1h", at, site: "https://vn-terminal.vercel.app/" }),
    "VNM · 1h · 2026-09-07 · vn-terminal.vercel.app",
  );
});

test("a paid export carries no stamp", () => {
  // The credit is what the free tier trades for the feature; charging for it and
  // still stamping it would be taking twice.
  assert.equal(footerText({ symbol: "VNM", tf: "1D", at, site: null }), null);
  assert.equal(footerText({ symbol: "VNM", tf: "1D", at }), null);
});
