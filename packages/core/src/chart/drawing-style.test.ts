import { test } from "node:test";
import assert from "node:assert/strict";
import { dashPattern, sanitizeStyle } from "./drawing-style.ts";

test("a stored style keeps its valid parts", () => {
  assert.deepEqual(sanitizeStyle({ color: "#F23645", width: 3, dash: "dotted" }), { color: "#f23645", width: 3, dash: "dotted" });
});

test("anything a style cannot hold is dropped rather than drawn", () => {
  assert.deepEqual(sanitizeStyle({ color: "red; background:url(x)", width: 9, dash: "wavy", extra: 1 }), undefined);
  assert.deepEqual(sanitizeStyle({ color: "#2962ff", width: 0 }), { color: "#2962ff" });
  assert.equal(sanitizeStyle(null), undefined);
  assert.equal(sanitizeStyle("dashed"), undefined);
});

test("a dash maps to its canvas pattern", () => {
  assert.deepEqual(dashPattern("solid"), []);
  assert.deepEqual(dashPattern(undefined), []);
  assert.ok(dashPattern("dashed").length === 2 && dashPattern("dotted").length === 2);
});

test("a stored drawing keeps a valid style and loses an invalid one", async () => {
  const { parseDrawings } = await import("./drawings.ts");
  const [a, b] = parseDrawings(JSON.stringify([
    { id: "a", kind: "hline", price: 60, style: { color: "#089981", width: 3, dash: "dashed" } },
    { id: "b", kind: "hline", price: 61, style: { color: "javascript:alert(1)", width: 7 } },
  ]));
  assert.deepEqual(a.style, { color: "#089981", width: 3, dash: "dashed" });
  assert.equal("style" in b, false);
});
