import test from "node:test";
import assert from "node:assert/strict";
import { blindInfo, compareRanks, evaluateBestFive, evaluateBestHand, rankName } from "./rules.mjs";

const card = (r, s) => ({ r, s });

test("盲注每五手升级并在表格结束后继续增长", () => {
  assert.deepEqual(blindInfo(1), { level: 1, sb: 10, bb: 20 });
  assert.deepEqual(blindInfo(5), { level: 1, sb: 10, bb: 20 });
  assert.deepEqual(blindInfo(6), { level: 2, sb: 15, bb: 30 });
  assert.equal(blindInfo(41).bb, 800);
});

test("七张牌评估覆盖皇家同花顺、葫芦和A2345顺子", () => {
  const royal = evaluateBestHand([
    card(14, "♠"), card(13, "♠"), card(12, "♠"), card(11, "♠"), card(10, "♠"), card(2, "♥"), card(3, "♣")
  ]);
  const fullHouse = evaluateBestHand([
    card(9, "♠"), card(9, "♥"), card(9, "♦"), card(4, "♠"), card(4, "♣"), card(2, "♥"), card(3, "♣")
  ]);
  const wheel = evaluateBestHand([
    card(14, "♠"), card(2, "♥"), card(3, "♦"), card(4, "♣"), card(5, "♠"), card(9, "♥"), card(10, "♣")
  ]);
  assert.equal(rankName(royal), "同花顺");
  assert.equal(rankName(fullHouse), "葫芦");
  assert.deepEqual(wheel, [4, 5]);
  assert.ok(compareRanks(royal, fullHouse) > 0);
});

test("同牌型按关键牌和踢脚逐项比较", () => {
  assert.ok(compareRanks([1, 14, 13, 9, 2], [1, 14, 12, 11, 10]) > 0);
  assert.equal(compareRanks([2, 10, 8, 14], [2, 10, 8, 14]), 0);
});

test("最佳牌型评估同时返回用于摊牌展示的准确五张牌", () => {
  const cards = [
    card(14, "♠"), card(13, "♠"), card(12, "♠"), card(11, "♠"), card(10, "♠"), card(10, "♥"), card(2, "♣")
  ];
  const result = evaluateBestFive(cards);
  assert.equal(rankName(result.rank), "同花顺");
  assert.equal(result.cards.length, 5);
  assert.deepEqual(new Set(result.cards.map((item) => item.s)), new Set(["♠"]));
});
