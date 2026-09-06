/**
 * Watchlist sync decisions.
 *
 * Two of these are security facts rather than conveniences: an unclaimed list
 * is the ONLY one that may be folded into an account, and a burst of stars must
 * reach the server in the order the reader made them.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  hasWrites,
  localWriteGeneration,
  markLocalWrite,
  noWrites,
  planSync,
  queueToggle,
} from "./watchlist-sync.ts";

const A = "test-albert@example.com";
const B = "test-albert-b@example.com";

// ── whose list is this ──────────────────────────────────────────────────────

test("a browser nobody has claimed folds its list into the account signing in", () => {
  assert.deepEqual(planSync(null, A), { clearLocal: false, action: "upload" });
});

test("a browser already claimed by this account mirrors the server", () => {
  assert.deepEqual(planSync(A, A), { clearLocal: false, action: "mirror" });
});

test("another account's list is dropped, never uploaded as the new reader's", () => {
  assert.deepEqual(
    planSync(A, B),
    { clearLocal: true, action: "mirror" },
    "uploading it would hand B everything A was watching",
  );
});

test("signing out clears a claimed list and asks the server for nothing", () => {
  assert.deepEqual(planSync(A, null), { clearLocal: true, action: "none" });
});

test("a signed-out reader with no marker is left entirely alone", () => {
  assert.deepEqual(
    planSync(null, null),
    { clearLocal: false, action: "none" },
    "the anonymous list is local only — no request, no write",
  );
});

// ── collapsing a burst of stars ─────────────────────────────────────────────

test("nothing queued is nothing to send", () => {
  assert.equal(hasWrites(noWrites()), false);
});

test("stars accumulate into one batch", () => {
  const w = queueToggle(queueToggle(noWrites(), "VNM", true), "FPT", true);
  assert.deepEqual(w, { add: ["VNM", "FPT"], remove: [] });
  assert.equal(hasWrites(w), true);
});

test("the last toggle of a symbol is the one that ships", () => {
  const on = queueToggle(noWrites(), "VNM", true);
  assert.deepEqual(queueToggle(on, "VNM", false), { add: [], remove: ["VNM"] }, "star then unstar is one removal");

  const off = queueToggle(noWrites(), "VNM", false);
  assert.deepEqual(queueToggle(off, "VNM", true), { add: ["VNM"], remove: [] });
});

test("repeating a toggle does not repeat the symbol", () => {
  const w = queueToggle(queueToggle(noWrites(), "VNM", true), "VNM", true);
  assert.deepEqual(w, { add: ["VNM"], remove: [] });
});

test("queueing leaves the batch it was given untouched", () => {
  const before = queueToggle(noWrites(), "VNM", true);
  queueToggle(before, "FPT", true);
  assert.deepEqual(before, { add: ["VNM"], remove: [] }, "a shared batch mutated in place loses writes");
});

// ── a response older than the reader's last click ───────────────────────────

test("a local write moves the generation a sync captured", () => {
  const captured = localWriteGeneration();
  markLocalWrite();
  assert.notEqual(
    localWriteGeneration(),
    captured,
    "an answer sent before this star must not be applied over it",
  );
});

test("a quiet moment leaves the generation alone", () => {
  const captured = localWriteGeneration();
  assert.equal(localWriteGeneration(), captured, "with no local write the server answer is still current");
});
