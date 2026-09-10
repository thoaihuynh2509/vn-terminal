import test from "node:test";
import assert from "node:assert/strict";
import { BRAND, brandName, brandTagline, mailFrom } from "./brand.ts";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getDict, LOCALES } from "./i18n/index.ts";

/**
 * The point of `brand.ts` is that renaming the product is ONE edit. These tests
 * fail if a literal creeps back in anywhere a reader can see it, which is the
 * only way that promise stays true.
 */
test("every dictionary string carries the configured name, never the old one", () => {
  for (const locale of LOCALES) {
    const dumped = JSON.stringify(getDict(locale));
    assert.ok(dumped.includes(BRAND.name), `${locale} dictionary lost the brand name`);
    assert.doesNotMatch(dumped, /vn.?terminal/i, `${locale} dictionary still names VN Terminal`);
  }
});

/**
 * Source scan rather than an import: the files that name the product hardest —
 * `ask/context.ts`, the OG images, the route handlers — import through the
 * `@/lib` alias or JSX, neither of which `node --test` can resolve. Reading
 * them as text checks the one thing that matters anyway, which is that no
 * literal survived.
 */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      out.push(...sourceFiles(full));
    } else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

test("no source file outside brand.ts names the product literally", () => {
  const root = join(import.meta.dirname, "..", "..", "..");
  const offenders: string[] = [];
  for (const dir of [join(root, "src"), join(root, "packages", "core", "src")]) {
    for (const file of sourceFiles(dir)) {
      if (file.endsWith(join("core", "src", "brand.ts"))) continue;
      if (/vn.?terminal/i.test(readFileSync(file, "utf8"))) offenders.push(file.slice(root.length + 1));
    }
  }
  assert.deepEqual(offenders, [], `rename these to BRAND.name: ${offenders.join(", ")}`);
});

test("both locales share the name and differ only in the tagline", () => {
  assert.equal(getDict("vi").brand, brandName());
  assert.equal(getDict("en").brand, brandName());
  assert.equal(getDict("vi").tagline, brandTagline("vi"));
  assert.equal(getDict("en").tagline, brandTagline("en"));
  assert.notEqual(brandTagline("vi"), brandTagline("en"));
});

test("the sign-in subject names the product in both locales", () => {
  for (const locale of LOCALES) {
    assert.ok(getDict(locale).auth.mailSubject.includes(BRAND.name));
  }
});

test("a configured sender wins over the shared fallback", () => {
  const saved = process.env.MAIL_FROM;
  try {
    process.env.MAIL_FROM = "Ai Do <no-reply@example.vn>";
    assert.equal(mailFrom(), "Ai Do <no-reply@example.vn>");

    // An empty string is the Vercel misconfiguration `??` would let through as
    // a sender of "", which Resend rejects for every message.
    process.env.MAIL_FROM = "";
    assert.equal(mailFrom(), `${BRAND.name} <onboarding@resend.dev>`);

    delete process.env.MAIL_FROM;
    assert.equal(mailFrom(), `${BRAND.name} <onboarding@resend.dev>`);
  } finally {
    if (saved === undefined) delete process.env.MAIL_FROM;
    else process.env.MAIL_FROM = saved;
  }
});

test("the fallback origin is a real absolute origin", () => {
  // site.ts hands this straight to `new URL()` inside generateMetadata, where a
  // throw takes down every route through the error boundary.
  const url = new URL(BRAND.defaultOrigin);
  assert.equal(url.protocol, "https:");
  assert.equal(BRAND.defaultOrigin.endsWith("/"), false);
});

test("the ascii slug is safe in an email local-part and a file name", () => {
  assert.match(BRAND.slug, /^[a-z0-9-]+$/);
});
