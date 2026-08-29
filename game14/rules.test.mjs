import assert from "node:assert/strict";
import test from "node:test";
import {
  ACTION_CARD_COUNT,
  BASE_CARD_COUNTS,
  CARD_COUNTS,
  EXPANDED_CARD_COUNTS,
  actionCardCount,
  createActionDeck,
  pigsPerPlayer
} from "./rules.mjs";

test("base Drecksau deck contains the original 54 action cards", () => {
  const deck = createActionDeck(() => 0.5);
  assert.equal(deck.length, 54);
  assert.equal(ACTION_CARD_COUNT, 54);
  assert.equal(new Set(deck.map((card) => card.id)).size, 54);
  for (const [type, count] of Object.entries(CARD_COUNTS)) {
    assert.equal(deck.filter((card) => card.type === type).length, count);
  }
});

test("pig count follows the base setup plus the official 5-6 player extension", () => {
  assert.equal(pigsPerPlayer(2), 5);
  assert.equal(pigsPerPlayer(3), 4);
  assert.equal(pigsPerPlayer(4), 3);
  assert.equal(pigsPerPlayer(5), 3);
  assert.equal(pigsPerPlayer(6), 3);
  assert.throws(() => pigsPerPlayer(7));
});

test("five and six players add only the three expansion barns", () => {
  assert.equal(actionCardCount(4), 54);
  assert.equal(actionCardCount(5), 57);
  assert.equal(actionCardCount(6), 57);
  assert.equal(BASE_CARD_COUNTS.barn, 9);
  assert.equal(EXPANDED_CARD_COUNTS.barn, 12);
  const expanded = createActionDeck(() => 0.5, 6);
  assert.equal(expanded.length, 57);
  assert.equal(expanded.filter((card) => card.type === "barn").length, 12);
  for (const type of Object.keys(BASE_CARD_COUNTS)) {
    if (type !== "barn") assert.equal(EXPANDED_CARD_COUNTS[type], BASE_CARD_COUNTS[type]);
  }
});
