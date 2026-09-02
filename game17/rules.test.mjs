import assert from "node:assert/strict";
import test from "node:test";
import {
  BID_LEVELS, COMPANIES, createMarketDeck, movePrice, roundsFor,
  stockpileCount, biddingTokenCount
} from "./rules.mjs";

test("基础版组件、轮数和竞价档位准确", () => {
  const deck = createMarketDeck();
  assert.equal(deck.length, 80);
  assert.equal(deck.filter((card) => card.kind === "stock").length, 60);
  assert.equal(deck.filter((card) => card.kind === "fee").length, 12);
  assert.equal(deck.filter((card) => card.kind === "action").length, 8);
  assert.equal(new Set(deck.map((card) => card.id)).size, 80);
  assert.equal(COMPANIES.length, 6);
  assert.deepEqual([2, 3, 4, 5].map(roundsFor), [6, 7, 6, 5]);
  assert.deepEqual(BID_LEVELS, [0, 1000, 3000, 6000, 10000, 15000, 20000, 25000]);
});

test("两人局使用四个股票堆和每人两个竞价标记", () => {
  assert.equal(stockpileCount(2), 4); assert.equal(biddingTokenCount(2), 2);
  assert.equal(stockpileCount(5), 5); assert.equal(biddingTokenCount(5), 1);
});

test("股价逐格处理拆股、越界剩余步数和破产", () => {
  assert.deepEqual(movePrice(9, 4), { price: 8, events: [{ type: "split" }] });
  assert.deepEqual(movePrice(2, -3), { price: 5, events: [{ type: "bankruptcy" }] });
  assert.deepEqual(movePrice(5, 2), { price: 7, events: [] });
});
