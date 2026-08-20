"use strict";

import test from "node:test";
import assert from "node:assert/strict";
import { applyMoves, commitTurn, completedColumns, dicePairings, legalMoveOptions, rollOptions } from "./rules.js";

test("four dice create the three unique pairings", () => {
  assert.deepEqual(dicePairings([1, 2, 3, 4]), [[3, 7], [4, 6], [5, 5]]);
  assert.deepEqual(dicePairings([1, 1, 1, 1]), [[2, 2]]);
});

test("a double advances the same column twice", () => {
  assert.deepEqual(legalMoveOptions([7, 7], {}, []), [[7, 7]]);
  assert.equal(applyMoves({}, {}, [7, 7])[7], 2);
});

test("only existing runners remain usable after all three are placed", () => {
  assert.deepEqual(legalMoveOptions([5, 9], { 4: 2, 5: 3, 8: 1 }, []), [[5]]);
  assert.deepEqual(legalMoveOptions([9, 10], { 4: 2, 5: 3, 8: 1 }, []), []);
});

test("one remaining runner creates separate choices for two new columns", () => {
  assert.deepEqual(legalMoveOptions([6, 8], { 4: 1, 5: 1 }, []), [[6], [8]]);
});

test("closed and completed columns cannot advance", () => {
  assert.deepEqual(rollOptions([1, 1, 1, 1], {}, [2]), []);
  assert.deepEqual(legalMoveOptions([2, 3], { 2: 3 }, []), [[3]]);
});

test("stopping commits progress and detects claimed columns", () => {
  const committed = commitTurn({ 7: 4 }, { 7: 6, 12: 3 });
  assert.deepEqual(committed, { 7: 6, 12: 3 });
  assert.deepEqual(completedColumns(committed), [12]);
});
