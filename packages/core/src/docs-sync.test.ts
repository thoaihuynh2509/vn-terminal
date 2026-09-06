import test from "node:test";
import assert from "node:assert/strict";
import { mergeById, planDoc, planSync } from "./docs-sync.ts";

const local = <T>(data: T, version: number, dirty: boolean) => ({ data, version, dirty });
const remote = <T>(data: T, version: number) => ({ data, version });

test("nothing on either side is nothing to do", () => {
  assert.equal(planDoc(null, null), "none");
});

test("a clean local copy with nothing on the server stays put", () => {
  // Not "upload": a copy that has never been edited has nothing to contribute,
  // and uploading it would resurrect a document the reader deleted elsewhere.
  assert.equal(planDoc(local({ a: 1 }, 0, false), null), "none");
});

test("unsent local edits with nothing on the server are uploaded", () => {
  assert.equal(planDoc(local({ a: 1 }, 0, true), null), "upload");
});

test("a first sync on a new device adopts what the account already has", () => {
  assert.equal(planDoc(null, remote({ a: 1 }, 3)), "adopt");
});

test("a newer server copy is adopted when there is nothing unsent", () => {
  assert.equal(planDoc(local({ a: 1 }, 2, false), remote({ a: 2 }, 5)), "adopt");
});

test("unsent edits against an unchanged server are uploaded", () => {
  assert.equal(planDoc(local({ a: 9 }, 5, true), remote({ a: 1 }, 5)), "upload");
});

test("both sides changed is the one real conflict, and it merges", () => {
  // Picking a winner here would silently discard whichever device the reader
  // was not looking at.
  assert.equal(planDoc(local({ a: 9 }, 2, true), remote({ a: 1 }, 5)), "merge");
});

test("everything already agrees", () => {
  assert.equal(planDoc(local({ a: 1 }, 4, false), remote({ a: 1 }, 4)), "none");
});

test("a local copy ahead of the server is never overwritten by it", () => {
  // Defensive: versions should not go backwards, but if they do, unsent work
  // must not lose.
  assert.equal(planDoc(local({ a: 9 }, 7, true), remote({ a: 1 }, 5)), "upload");
});

// ── mergeById ───────────────────────────────────────────────────────────────

test("a merge keeps work from both devices", () => {
  const merged = mergeById(
    [{ id: "a", v: 1 }, { id: "b", v: 1 }],
    [{ id: "c", v: 1 }],
  );
  assert.deepEqual(merged.map((x) => x.id), ["a", "b", "c"]);
});

test("the copy in front of the reader wins a same-id collision", () => {
  const merged = mergeById([{ id: "a", v: "mine" }], [{ id: "a", v: "theirs" }]);
  assert.deepEqual(merged, [{ id: "a", v: "mine" }]);
});

test("merging is stable and never duplicates an id", () => {
  const merged = mergeById(
    [{ id: "a" }, { id: "b" }],
    [{ id: "b" }, { id: "a" }, { id: "c" }],
  );
  assert.deepEqual(merged.map((x) => x.id), ["a", "b", "c"]);
  assert.equal(new Set(merged.map((x) => x.id)).size, merged.length);
});

test("merging with an empty side is the other side", () => {
  assert.deepEqual(mergeById([], [{ id: "a" }]), [{ id: "a" }]);
  assert.deepEqual(mergeById([{ id: "a" }], []), [{ id: "a" }]);
});

// ── ownership is the watchlist's rule, not a second one ─────────────────────

test("another account's saved work is dropped, never uploaded", () => {
  assert.deepEqual(planSync("a@b.co", "c@d.co"), { clearLocal: true, action: "mirror" });
  assert.deepEqual(planSync(null, "c@d.co"), { clearLocal: false, action: "upload" });
  assert.deepEqual(planSync("c@d.co", "c@d.co"), { clearLocal: false, action: "mirror" });
  assert.deepEqual(planSync("a@b.co", null), { clearLocal: true, action: "none" });
});
