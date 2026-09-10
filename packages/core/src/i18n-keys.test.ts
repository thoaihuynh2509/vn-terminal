import test from "node:test";
import assert from "node:assert/strict";
import { getDict } from "./i18n/index.ts";

/**
 * The two dictionaries must have identical shapes.
 *
 * `Dict = typeof vi`, so a key added only to `vi` type-checks everywhere and
 * then renders `undefined` for English readers, while a key added only to `en`
 * is invisible to the compiler entirely. Neither failure shows up in a build —
 * the first one a reader notices is a blank label, or a crash from calling
 * `.replace` on a missing string. Diffing the key sets catches both.
 */
function paths(value: unknown, prefix = ""): string[] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return [prefix];
  const out: string[] = [];
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out.push(...paths(v, prefix ? `${prefix}.${k}` : k));
  }
  return out;
}

test("vi and en dictionaries expose exactly the same keys", () => {
  const vi = new Set(paths(getDict("vi")));
  const en = new Set(paths(getDict("en")));

  const missingInEn = [...vi].filter((k) => !en.has(k)).sort();
  const missingInVi = [...en].filter((k) => !vi.has(k)).sort();

  assert.deepEqual(missingInEn, [], `keys present in vi but missing from en: ${missingInEn.join(", ")}`);
  assert.deepEqual(missingInVi, [], `keys present in en but missing from vi: ${missingInVi.join(", ")}`);
});

test("no dictionary string is empty — a blank label reads as a broken page", () => {
  for (const locale of ["vi", "en"] as const) {
    const dict = getDict(locale) as unknown as Record<string, unknown>;
    for (const path of paths(dict)) {
      const value = path.split(".").reduce<unknown>(
        (node, key) => (node as Record<string, unknown>)?.[key],
        dict,
      );
      if (typeof value === "string") {
        assert.notEqual(value.trim(), "", `${locale}.${path} is empty`);
      }
    }
  }
});

/**
 * `sectionMetadata` uses each section's visible subtitle as its meta
 * description, deliberately, so the sentence a searcher reads on Google is the
 * one the page shows and the two cannot drift. That makes subtitle length an
 * SEO property: Google truncates past roughly 160 characters and rewrites
 * descriptions it considers too thin, which is what it did to the 40-character
 * ones these replaced.
 */
test("every indexed section's subtitle is a usable meta description", () => {
  const SECTIONS = ["stocks", "gold", "crypto", "chart", "heatmap", "pricing", "brief"] as const;
  for (const locale of ["vi", "en"] as const) {
    const dict = getDict(locale) as unknown as Record<string, { subtitle?: string }>;
    for (const section of SECTIONS) {
      const subtitle = dict[section]?.subtitle;
      assert.equal(typeof subtitle, "string", `${locale}.${section}.subtitle is missing`);
      const n = (subtitle as string).length;
      assert.ok(n >= 100 && n <= 160, `${locale}.${section}.subtitle is ${n} chars, want 100-160`);
    }
  }
});
