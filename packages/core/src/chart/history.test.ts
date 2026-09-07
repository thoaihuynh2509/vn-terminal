import test from "node:test";
import assert from "node:assert/strict";
import {
  HISTORY_DEPTH, canRedo, canUndo, current, initHistory, push, redo, reset, undo,
} from "./history.ts";

const seq = (...v: number[]) => v.reduce((h, n) => push(h, n), initHistory(0));

test("a fresh stack holds its seed and can go nowhere", () => {
  const h = initHistory("a");
  assert.equal(current(h), "a");
  assert.equal(canUndo(h), false);
  assert.equal(canRedo(h), false);
});

test("undo walks back and redo walks forward", () => {
  const h = seq(1, 2, 3);
  assert.equal(current(h), 3);
  const b = undo(undo(h));
  assert.equal(current(b), 1);
  assert.equal(current(redo(b)), 2);
});

test("undoing past the beginning stays at the beginning", () => {
  let h = seq(1);
  for (let i = 0; i < 5; i++) h = undo(h);
  assert.equal(current(h), 0);
  assert.equal(canUndo(h), false);
});

test("redoing past the end stays at the end", () => {
  let h = seq(1, 2);
  for (let i = 0; i < 5; i++) h = redo(h);
  assert.equal(current(h), 2);
  assert.equal(canRedo(h), false);
});

test("a new action after undo discards the abandoned branch", () => {
  // The reader chose a different branch; keeping the old one would make redo
  // do something nobody asked for.
  const h = push(undo(seq(1, 2)), 99);
  assert.equal(current(h), 99);
  assert.equal(canRedo(h), false);
  assert.equal(current(undo(h)), 1);
});

test("an unchanged state does not consume a step", () => {
  // A drag that ends where it started should not cost the reader an undo.
  const same = (a: number, b: number) => a === b;
  const h = push(seq(1), 1, same);
  assert.equal(canUndo(undo(h)), false);
});

test("the stack is capped and drops the OLDEST state", () => {
  let h = initHistory(0);
  for (let i = 1; i <= HISTORY_DEPTH + 20; i++) h = push(h, i);
  assert.ok(h.past.length <= HISTORY_DEPTH, `${h.past.length}`);
  assert.equal(current(h), HISTORY_DEPTH + 20);
  // Walking all the way back lands on the oldest SURVIVING state, not on 0.
  let back = h;
  while (canUndo(back)) back = undo(back);
  assert.ok(current(back) > 0, "the oldest state should have been trimmed");
});

test("a capped stack still undoes the full depth", () => {
  let h = initHistory(0);
  for (let i = 1; i <= HISTORY_DEPTH + 20; i++) h = push(h, i);
  let steps = 0;
  let back = h;
  while (canUndo(back)) { back = undo(back); steps++; }
  assert.equal(steps, HISTORY_DEPTH - 1);
});

test("history never mutates the value it was given", () => {
  const a = [1, 2];
  const h = push(initHistory(a), [1, 2, 3]);
  assert.deepEqual(a, [1, 2]);
  assert.deepEqual(current(undo(h)), [1, 2]);
});

test("reset replaces the present without leaving a step behind", () => {
  // Another tab or a sync is not the reader's own action; undoing it would
  // re-upload the state their other device just replaced.
  const h = reset(seq(1, 2, 3) && "remote");
  assert.equal(current(h), "remote");
  assert.equal(canUndo(h), false);
  assert.equal(canRedo(h), false);
});
