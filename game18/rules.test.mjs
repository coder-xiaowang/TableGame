import assert from "node:assert/strict";
import test from "node:test";
import {
  CARD_META, CARDS, FULL_DECK_SIZE, REQUIRED_BY_PLAYER_COUNT,
  createFullDeck, createRoundDeck, leftIndex, rightIndex
} from "./rules.mjs";

test("第三版完整牌组为32张且ID唯一", () => {
  const deck = createFullDeck();
  assert.equal(FULL_DECK_SIZE, 32);
  assert.equal(deck.length, 32);
  assert.equal(new Set(deck.map((card) => card.id)).size, 32);
  for (const [type, meta] of Object.entries(CARD_META)) assert.equal(deck.filter((card) => card.type === type).length, meta.count);
});

test("3至8人牌组均为每人4张并包含人数必选牌", () => {
  for (let players = 3; players <= 8; players += 1) {
    const deck = createRoundDeck(players, () => 0.37);
    assert.equal(deck.length, players * 4);
    assert.equal(new Set(deck.map((card) => card.id)).size, deck.length);
    assert.equal(deck.filter((card) => card.type === CARDS.CRIMINAL).length, 1);
    assert.equal(deck.filter((card) => card.type === CARDS.DISCOVERER).length, 1);
    for (const [type, count] of Object.entries(REQUIRED_BY_PLAYER_COUNT[players])) {
      assert.ok(deck.filter((card) => card.type === type).length >= count, `${players}人局缺少${type}`);
    }
  }
});

test("左右座位索引在环形桌面正确循环", () => {
  assert.equal(leftIndex(3, 4), 0);
  assert.equal(rightIndex(0, 4), 3);
});

