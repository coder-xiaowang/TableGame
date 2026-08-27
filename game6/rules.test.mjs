import assert from "node:assert/strict";
import test from "node:test";
import { bullheads, rowBullheads, shuffledDeck, targetRowIndex } from "./rules.mjs";

test("bullhead values follow the special-number priority",() => {
  assert.equal(bullheads(55),7);
  assert.equal(bullheads(22),5);
  assert.equal(bullheads(20),3);
  assert.equal(bullheads(15),2);
  assert.equal(bullheads(17),1);
  assert.equal(rowBullheads([55,20,15,17]),13);
});

test("target row is the closest smaller ending",() => {
  const rows = [[4,12],[20],[31,40],[60]];
  assert.equal(targetRowIndex(rows,41),2);
  assert.equal(targetRowIndex(rows,19),0);
  assert.equal(targetRowIndex(rows,3),-1);
});

test("shuffled deck contains each card exactly once",() => {
  const deck = shuffledDeck(() => 0.25);
  assert.equal(deck.length,104);
  assert.deepEqual([...deck].sort((left,right) => left-right),Array.from({length:104},(_,index) => index+1));
});
