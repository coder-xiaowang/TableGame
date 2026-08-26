import assert from "node:assert/strict";
import test from "node:test";
import { CATEGORIES, categoryScore, isYahtzee, newScorecard, totals } from "./rules.mjs";

test("game3 exposes thirteen empty score categories", () => {
  const scorecard = newScorecard();
  assert.equal(CATEGORIES.length, 13);
  assert.equal(Object.keys(scorecard).length, 13);
  assert.ok(Object.values(scorecard).every((value) => value === null));
});

test("game3 scores upper section, kinds and chance", () => {
  assert.equal(categoryScore("sixes", [6, 6, 6, 2, 1]), 18);
  assert.equal(categoryScore("threeKind", [4, 4, 4, 2, 1]), 15);
  assert.equal(categoryScore("fourKind", [4, 4, 4, 4, 1]), 17);
  assert.equal(categoryScore("fourKind", [4, 4, 4, 2, 1]), 0);
  assert.equal(categoryScore("chance", [1, 2, 3, 4, 6]), 16);
});

test("game3 applies strict full house and straight rules", () => {
  assert.equal(categoryScore("fullHouse", [2, 2, 3, 3, 3]), 25);
  assert.equal(categoryScore("fullHouse", [2, 2, 2, 2, 2]), 0);
  assert.equal(categoryScore("smallStraight", [1, 2, 3, 4, 4]), 30);
  assert.equal(categoryScore("smallStraight", [1, 2, 3, 5, 6]), 0);
  assert.equal(categoryScore("largeStraight", [2, 3, 4, 5, 6]), 40);
  assert.equal(categoryScore("largeStraight", [1, 2, 3, 4, 4]), 0);
});

test("game3 detects and totals Yahtzee bonuses", () => {
  assert.equal(isYahtzee([5, 5, 5, 5, 5]), true);
  assert.equal(categoryScore("yahtzee", [5, 5, 5, 5, 5]), 50);
  const player = { scorecard: newScorecard(), yahtzeeBonus: 100 };
  Object.assign(player.scorecard, {
    ones: 3, twos: 6, threes: 9, fours: 12, fives: 15, sixes: 18,
    chance: 20
  });
  assert.deepEqual(totals(player), {
    upper: 63,
    upperBonus: 35,
    lower: 20,
    yahtzeeBonus: 100,
    total: 218
  });
});
