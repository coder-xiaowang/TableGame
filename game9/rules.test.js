"use strict";

import test from "node:test";
import assert from "node:assert/strict";
import { cardScore, finalScore, startingChips } from "./rules.js";

test("starting chips follow the standard player-count table", () => {
  assert.equal(startingChips(3), 11);
  assert.equal(startingChips(5), 11);
  assert.equal(startingChips(6), 9);
  assert.equal(startingChips(7), 7);
  assert.throws(() => startingChips(2), RangeError);
});

test("only the lowest card in each consecutive run scores", () => {
  assert.equal(cardScore([8, 13, 14, 15, 17]), 38);
  assert.equal(cardScore([17, 14, 8, 16, 13, 15]), 21);
  assert.equal(cardScore([]), 0);
});

test("remaining chips reduce the final score", () => {
  assert.equal(finalScore({ cards: [8, 13, 14, 15, 17], chips: 13 }), 25);
});
