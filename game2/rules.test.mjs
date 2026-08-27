import assert from "node:assert/strict";
import test from "node:test";
import { IDIOMS } from "./idioms.js";
import {
  PLAYER_COUNTS, createIdiomDeck, drawIdiom, normalizeText, roleForSeat, teamIndexForSeat
} from "./rules.mjs";

test("game2 idiom source is large, unique and four Chinese characters", () => {
  assert.ok(IDIOMS.length >= 7_000);
  assert.equal(new Set(IDIOMS).size, IDIOMS.length);
  assert.ok(IDIOMS.every((idiom) => /^[\u3400-\u9fff]{4}$/u.test(idiom)));
});

test("game2 text normalization follows exact-match rules", () => {
  assert.equal(normalizeText(" 画 龙，点睛！ "), "画龙点睛");
  assert.equal(normalizeText("Ab C."), "abc");
  assert.notEqual(normalizeText("画龙点睛"), normalizeText("画蛇添足"));
});

test("game2 seats map to two-person teams and roles", () => {
  assert.deepEqual(PLAYER_COUNTS, [2,4,6,8]);
  assert.deepEqual(Array.from({length:8},(_,index) => roleForSeat(index)), [
    "captain","member","captain","member","captain","member","captain","member"
  ]);
  assert.deepEqual(Array.from({length:8},(_,index) => teamIndexForSeat(index)), [0,0,1,1,2,2,3,3]);
});

test("game2 idiom deck is deterministic and avoids an immediate repeat", () => {
  const first = createIdiomDeck(() => 0);
  const second = createIdiomDeck(() => 0);
  assert.deepEqual(first, second);
  assert.equal(first.length, IDIOMS.length);
  const deck = ["画龙点睛", "守株待兔"];
  assert.equal(drawIdiom(deck, "守株待兔"), "画龙点睛");
});
